/* SkillStreak staff console — shell.
 *
 * Deliberately dependency-free and build-step-free, matching site/'s own
 * plain-HTML convention. A staff console used by a handful of adults at
 * human frequency does not need a framework, and adding a bundler here
 * would mean a second build pipeline in a repo that currently has one.
 *
 * **Served same-origin with the API, on purpose.** ADR-0023 Decision B2 is
 * explicit that the staff surface is not covered by the app's CORS block:
 * `SameSite=Strict` on `staff_session` is the boundary for it, and that
 * only works for a same-origin page. Hence the API serves this under
 * /console rather than the marketing site hosting it. Move it to another
 * origin and authentication silently stops working.
 */
(function () {
  'use strict';

  function request(method, path, body) {
    return fetch(path, {
      method: method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (!r.ok) {
        return r.json().then(function (body) {
          /* Not every 401 is a sign-out, and treating them alike logged the
           * operator out of a working session.
           *
           * ADR-0022 Decision 10's step-up gate answers 401 with the code
           * `reauth_required` on the three planning/* endpoints — the
           * session is valid and STAYS valid, every other admin endpoint
           * keeps working, and the exception's own comment says the console
           * "must render AD5's inline re-auth prompt over a preserved
           * console state rather than treating this as a sign-out".
           *
           * This helper used to throw `{unauthenticated:true}` on status
           * alone, before reading the body, so the code was discarded and
           * the planning tab dropped straight to the login screen. The body
           * has to be read first; the status alone does not carry enough. */
          if (r.status === 401 && body?.error?.code !== 'reauth_required') {
            throw { unauthenticated: true };
          }
          throw body;
        }, function () {
          /* No JSON body to read — a proxy or gateway error rather than one
           * of ours. A bare 401 here really is "signed out". */
          throw r.status === 401 ? { unauthenticated: true } : { status: r.status };
        });
      }
      return r.status === 204 ? null : r.json();
    });
  }

  var api = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    put: function (path, body) { return request('PUT', path, body); },
    del: function (path) { return request('DELETE', path); },
    patch: function (path, body) { return request('PATCH', path, body); }
  };

  /* The send-list filters. `todo` is first and is the default, because
   * "who have I not contacted yet" is the question this page is opened to
   * answer once invitations start going out. */
  var SIGNUP_FILTERS = {
    todo: {
      label: 'To invite',
      /* Only people who actually asked for a demo. Since 2026-08-21 that
       * is a box on the form rather than the whole point of it, and
       * someone who signed up for release news alone must never appear on
       * a send list for a Google Meet they did not ask for. */
      match: function (row) {
        return !!row.demoInviteRequestedAt && !row.inviteSentAt;
      }
    },
    invited: {
      label: 'Already invited',
      match: function (row) { return !!row.inviteSentAt; }
    },
    releases: {
      label: 'Release news',
      match: function (row) { return !!row.releaseUpdatesOptedInAt; }
    },
    all: { label: 'Everyone', match: function () { return true; } }
  };

  function interestSummary(rows) {
    var counts = {};
    rows.forEach(function (row) {
      counts[row.interest] = (counts[row.interest] || 0) + 1;
    });
    var parts = Object.keys(counts).map(function (key) {
      return (INTEREST_LABEL[key] || key) + ': ' + counts[key];
    });
    return parts.length ? parts.join(' · ') : 'Nobody yet.';
  }

  /* Exception class names → what an operator should read. The class is
   * how the "why" travels, since the wire message is deliberately
   * identical for every 401. */
  var ERROR_NAME_LABEL = {
    StaffSessionMissingException: 'Not signed in',
    StaffSessionExpiredException: 'Session timed out',
    StaffSessionInvalidException: 'Bad signature — check STAFF_JWT_SECRET',
    StaffAccountGoneException: 'Account row missing',
    StaffAccountRevokedException: 'Account revoked',
    StaffAccountNotAdminException: 'Not an admin',
    StaffAccountNotPtException: 'Not a trainer'
  };

  var INTEREST_LABEL = {
    curious: 'Just curious',
    invest: 'Investment',
    // Distinct from `invest` on purpose — see the enum's own comment.
    // "Wants to know about investing" and "is offering to co-own this"
    // are different conversations, and this is the one not to lose in a
    // long list.
    co_owner: 'Wants to co-own',
    contribute: 'Wants to help build',
    trainer: 'Wants to be a trainer',
    other: 'Other'
  };

  /* Wire error codes → what a trainer should actually read. Anything not
   * listed falls back to the raw code, which is ugly but honest: inventing
   * reassuring copy for an error we did not anticipate is worse. */
  var ERROR_COPY = {
    /* The first thing a newly signed-in trainer sees, and until
     * 2026-08-26 it read "Something went wrong
     * (drill_library_requires_team_link)" — which to a floorball coach
     * means the app is broken, not that they have one step left. The
     * server's own message was already fine; this table simply had no
     * entry, so the generic fallback won.
     *
     * Phrased as the next action rather than the rule. "Requires a team
     * link" is our vocabulary; "ask your captain for a code" is theirs. */
    drill_library_requires_team_link:
      'A team needs to invite you before this opens. Ask the captain for ' +
      'an 8-character code, then redeem it under My teams — the invitation ' +
      'always travels from the team to you, never the other way.',
    pt_invite_code_invalid:
      'That code is not valid. Codes are 8 characters and can only be used ' +
      'once — ask the captain for a fresh one.',
    pt_team_link_already_active:
      'You are already linked to that team.',
    pt_no_active_team_link:
      'You are not linked to that team any more. A captain can revoke a ' +
      'link at any time, and does not have to say why.',
    pt_consent_already_active:
      'You already have access to this player.',
    pt_consent_rate_limited:
      'Too many consent requests in a short time. Try again later — this ' +
      'limit protects families from being chased.',
    pt_consent_pending_cap_exceeded:
      'You have too many requests still waiting for an answer. Wait for ' +
      'some of those before asking more families.',
    pt_consent_blocked_pending_contact_change:
      'This family is currently changing their contact details, so requests ' +
      'are paused. Try again in a day or so.',
    pt_consent_not_approved:
      'You do not have consent for this player.',
    reauth_required:
      'This section needs you to confirm it is you.'
  };

  function errorCode(e) {
    return (e && e.error && e.error.code) || (e && e.code) ||
           (e && e.status) || 'unknown';
  }

  function errorMessage(e) {
    var code = errorCode(e);
    return ERROR_COPY[code] || ('Something went wrong (' + code + ').');
  }

  var el = function (id) { return document.getElementById(id); };
  /**
   * `role` is what the server says this account IS. `mode` is which surface
   * is currently being looked at.
   *
   * They differ only for an admin, who may also act as a trainer. That is
   * a view switch and nothing more: the server grants a trainer nothing
   * until a captain issues an invite code and a parent approves each child,
   * both re-checked live per request. An admin in trainer mode sees exactly
   * what that account has been *given*, which starts at nothing.
   */
  var state = { role: null, mode: null, session: null, tab: null, lang: 'en' };

  function canSwitchMode() {
    return state.role === 'admin';
  }

  /* Which tabs a role sees. The server enforces all of it — every /admin
   * route is behind AdminAuthGuard regardless of what this array says, so
   * this is navigation, not security. */
  var TABS = {
    admin: [
      { id: 'graphs', label: 'Graphs', ico: '📈' },
      { id: 'stats', label: 'Statistics', ico: '📊' },
      { id: 'signups', label: 'Demo signups', ico: '📬' },
      { id: 'campaigns', label: 'Campaigns', ico: '📣' },
      { id: 'errors', label: 'Errors', ico: '⚠️' },
      { id: 'bugs', label: 'Bug reports', ico: '🐛' },
      { id: 'planning', label: 'Planning', ico: '🗺️' },
      { id: 'drills', label: 'Drill library', ico: '📗' },
      { id: 'plans', label: 'Session planner', ico: '🧠' },
      { id: 'posts', label: 'My tips', ico: '✍️' },
      { id: 'postReview', label: 'Tip review', ico: '🔎' },
      { id: 'tagging', label: 'AI health', ico: '🏷️' }
    ],
    pt: [
      { id: 'teams', label: 'My teams', ico: '🏑' },
      { id: 'drills', label: 'Drill library', ico: '📗' },
      { id: 'plans', label: 'Session planner', ico: '🧠' },
      { id: 'posts', label: 'My tips', ico: '✍️' }
    ]
  };

  /* Detail routes belong to a tab without being one. Without this, opening
   * a team unlit the only nav item a trainer has, which reads as "you have
   * navigated out of the app". */
  var ROUTE_TAB = {
    team: 'teams', player: 'teams', graphs: 'graphs', drill: 'drills',
    drillGroups: 'drills', plan: 'plans', bugs: 'bugs',
    // Reached from both "My tips" and "Tip review"; highlights the
    // authoring tab, since that is where the preview is used most.
    playerPreview: 'posts'
  };

  function tabForRoute(route) {
    var root = String(route).split('/')[0];
    return ROUTE_TAB[root] || root;
  }

  function plural(count, singular, pluralForm) {
    return count + ' ' + (count === 1 ? singular : (pluralForm || singular + 's'));
  }

  function show(which) {
    el('login').style.display = which === 'login' ? '' : 'none';
    el('shell').classList.toggle('is-on', which === 'shell');
    if (which === 'login') renderSsoButtons();
  }

  var PROVIDER_LABEL = {
    google: 'Continue with Google',
    microsoft: 'Continue with Microsoft',
    apple: 'Continue with Apple'
  };

  /**
   * Draws a sign-in button per provider that actually has a registered
   * OAuth application, asked of the server rather than hardcoded.
   *
   * If the list cannot be fetched the buttons are not guessed — the note
   * below says so instead. A sign-in page that offers a route which
   * cannot work is worse than one that admits it does not know: the first
   * sends an operator into a 500, the second tells them to look at the
   * deployment.
   */
  function renderSsoButtons() {
    var host = el('ssoButtons');
    if (!host || host.dataset.done === '1') return;
    fetch('/api/v1/staff-auth/providers', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var list = data && data.providers ? data.providers : [];
        host.dataset.done = '1';
        if (!list.length) {
          el('loginNote').textContent =
            'No sign-in provider is configured for this deployment yet.';
          return;
        }
        host.innerHTML = list.map(function (p) {
          return '<a class="sso" href="/api/v1/staff-auth/' +
            encodeURIComponent(p) + '/login">' +
            esc(PROVIDER_LABEL[p] || p) + '</a>';
        }).join('');
      })
      .catch(function () {
        host.dataset.done = '1';
        el('loginNote').textContent =
          'Could not reach the server to list sign-in options. Reload to retry.';
      });
  }

  /**
   * The Admin / Trainer switch, drawn only for accounts that can do both.
   *
   * A view switch, not a privilege switch — the server does not know or
   * care which mode is selected, and being in trainer mode neither adds nor
   * removes anything. That is worth stating on screen too, because a
   * control labelled "mode" invites the assumption that it grants
   * something.
   */
  function renderModeSwitch() {
    var host = el('modeSwitch');
    if (!host) return;
    if (!canSwitchMode()) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML =
      '<div class="mode" role="group" aria-label="View mode">' +
        ['admin', 'pt'].map(function (mode) {
          return '<button data-mode="' + mode + '"' +
            (state.mode === mode ? ' class="is-on"' : '') + '>' +
            (mode === 'admin' ? 'Admin' : 'Trainer') + '</button>';
        }).join('') +
      '</div>';

    Array.prototype.forEach.call(
      host.querySelectorAll('[data-mode]'),
      function (button) {
        button.onclick = function () {
          var mode = button.getAttribute('data-mode');
          if (mode === state.mode) return;
          state.mode = mode;
          /* Land on that surface's first tab rather than trying to map the
           * current one across — the two have no tabs in common. */
          go(TABS[mode][0].id);
        };
      }
    );
  }

  function renderLangSwitch() {
    var host = el('langSwitch');
    if (!host) return;
    /* Only on the trainer surface. The admin pillars are deliberately
     * untranslated — "suppression floor", "step-up" have no settled
     * Swedish — so offering the toggle there produced a half-Swedish
     * console rather than a Swedish one. The code and the comment
     * claiming "only the trainer surface" now agree. */
    if (state.mode !== 'pt') {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML = ['sv', 'en'].map(function (lang) {
      return '<button data-lang="' + lang + '"' +
        (state.lang === lang ? ' class="is-on"' : '') + '>' +
        lang.toUpperCase() + '</button>';
    }).join('');
    Array.prototype.forEach.call(
      host.querySelectorAll('[data-lang]'),
      function (button) {
        button.onclick = function () {
          var lang = button.getAttribute('data-lang');
          if (lang !== state.lang) setLang(lang);
        };
      }
    );
  }

  function renderNav() {
    renderModeSwitch();
    renderLangSwitch();
    var nav = el('nav');
    nav.innerHTML = '';
    (TABS[state.mode] || []).forEach(function (tab) {
      var b = document.createElement('button');
      b.innerHTML = '<span class="ico" aria-hidden="true">' + esc(tab.ico || '') +
        '</span><span>' + esc(tab.label) + '</span>';
      b.className = tab.id === tabForRoute(state.tab) ? 'is-active' : '';
      b.onclick = function () { go(tab.id); };
      nav.appendChild(b);
    });
  }

  /* Routes are `name` or `name/<id>` — enough for team and player detail
   * without pulling in a router. The nav highlights the *root* of the
   * route, so "My teams" stays lit while you are inside a team. */
  function go(route) {
    state.tab = route;
    if (location.hash.replace('#', '') !== route) location.hash = route;
    renderNav();
    var view = el('view');
    view.innerHTML = '<p class="muted">Loading…</p>';
    var parts = route.split('/');
    var render = VIEWS[parts[0]];
    if (!render) { view.innerHTML = ''; return; }
    render(view, decodeURIComponent(parts[1] || ''));
    /* Views render asynchronously (they await an API call), so the
     * initial pass catches the loading state and a MutationObserver
     * catches the real content when it lands. */
    translateTree(view);
  }

  /* One observer for the lifetime of the page rather than one per render:
   * re-creating it on every navigation was the obvious first shape and
   * leaks an observer each time. */
  var viewObserver = new MutationObserver(function () {
    translateTree(el('view'));
    translateTree(el('nav'));
  });

  viewObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('hashchange', function () {
    var route = location.hash.replace('#', '');
    if (route && route !== state.tab) go(route);
  });

  /**
   * The tab a step-up round trip should come back to, consumed once.
   *
   * Read-and-clear rather than read: leaving it set would drag the operator
   * back to Planning on every subsequent sign-in, which is a worse bug than
   * the one it fixes and much harder to notice.
   */
  function returnTo() {
    try {
      var tab = sessionStorage.getItem('skillstreak.returnTo');
      sessionStorage.removeItem('skillstreak.returnTo');
      return tab && TABS.admin.some(function (t) { return t.id === tab; })
        ? tab
        : null;
    } catch (e) {
      return null;
    }
  }

  function alertInline(afterElement, message) {
    var note = document.createElement('div');
    note.className = 'err';
    note.style.fontSize = '13px';
    note.textContent = message;
    afterElement.parentNode.appendChild(note);
  }

  /**
   * CSV built here rather than server-side — the admin already has every
   * row on screen, so a download endpoint would be a second copy of the
   * same authorisation decision.
   *
   * Carries `UnsubscribeUrl` per row on purpose: the first round of
   * invitations is mailed by hand from this file, and every message to a
   * consent-based list needs a way off it. A mail merge is not an excuse
   * for omitting one, so the column travels with the addresses.
   *
   * `'` is prefixed to any cell starting with = + - @ on purpose. Notes and
   * campaign strings are typed by strangers on a public form, and a
   * spreadsheet treats a leading `=` as a formula — so an unescaped export
   * turns a text field into code execution on the machine of whoever opens
   * it. Quoting alone does not prevent that; the leading apostrophe does.
   */
  function downloadCsv(rows, filter) {
    function cell(value) {
      var text = String(value == null ? '' : value);
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }
    var header = ['Registered', 'Name', 'Email', 'Interest', 'Language',
                  'Campaign', 'Note', 'Invited', 'ReleaseNewsOptIn',
                  'DemoInviteAsked', 'UnsubscribeUrl'];
    var lines = [header.map(cell).join(',')].concat(rows.map(function (row) {
      return [row.createdAt, row.name, row.email,
              INTEREST_LABEL[row.interest] || row.interest, row.locale,
              row.campaign || '', row.note || '', row.inviteSentAt || '',
              /* Exported as the consent date rather than yes/no: a mail
               * merge sent from outside this app is exactly where someone
               * needs to be able to prove when the person agreed. */
              row.releaseUpdatesOptedInAt || '',
              row.demoInviteRequestedAt || '',
              row.unsubscribeUrl || ''].map(cell).join(',');
    }));
    // BOM so Excel opens UTF-8 correctly — å/ä/ö are guaranteed here.
    var blob = new Blob(['﻿' + lines.join('\r\n')],
                        { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'skillstreak-demo-signups-' + (filter || 'all') + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function backLink(route, label) {
    return '<p><button class="link" data-go="' + esc(route) + '">←&nbsp;' +
           '<span>' + esc(label) + '</span></button></p>';
  }

  /* Delegated, so re-rendering innerHTML never leaves a dead handler. */
  el('view').addEventListener('click', function (event) {
    var target = event.target.closest('[data-go]');
    if (target) go(target.getAttribute('data-go'));
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }




  /**
   * Weekly-goal target metrics, which arrive as raw enum values
   * (`total-pass`, `drill-minuter`). Rendering those straight was ugly in
   * both languages and meaningless to a trainer — and they cannot go
   * through the text-node translator, because they are DATA rather than
   * copy, so they are mapped explicitly here.
   *
   * Unknown values fall through to the raw string rather than to a blank:
   * a metric added server-side should look unfinished, not absent.
   */
  var METRIC_LABEL = {
    en: {
      'fitness-minuter': 'fitness minutes',
      'drill-minuter': 'drill minutes',
      'running-minuter': 'running minutes',
      'other-minuter': 'other minutes',
      'total-minuter': 'minutes in total',
      'fitness-pass': 'fitness sessions',
      'drill-pass': 'drill sessions',
      'running-pass': 'running sessions',
      'other-pass': 'other sessions',
      'total-pass': 'sessions in total'
    },
    sv: {
      'fitness-minuter': 'konditionsminuter',
      'drill-minuter': 'teknikminuter',
      'running-minuter': 'löpminuter',
      'other-minuter': 'övriga minuter',
      'total-minuter': 'minuter totalt',
      'fitness-pass': 'konditionspass',
      'drill-pass': 'teknikpass',
      'running-pass': 'löppass',
      'other-pass': 'övriga pass',
      'total-pass': 'pass totalt'
    }
  };

  function metricLabel(metric) {
    var table = METRIC_LABEL[effectiveLang()] || METRIC_LABEL.en;
    return table[metric] || metric;
  }

  /* Mirrors DRILL_AGE_BANDS in drill-library.service.ts. Used by the
   * planner and the tip editor, and referenced by both before it was
   * ever declared — which threw a ReferenceError, rendered "Something
   * went wrong", and went unnoticed because neither view had a user yet.
   * See check-console.mjs, which now fails on exactly that. */
  var DRILL_AGE_BANDS = ['9-11', '11-13', '13+'];

  var DRILL_FOCUSES = ['teknik', 'fys', 'skott', 'passning', 'spelforstaelse'];

  /**
   * Length bands rather than a slider.
   *
   * A coach picking a drill is not asking for "between 12 and 18 minutes";
   * they have a gap at the end of practice, or a whole session to fill.
   * Three bands answer that question and a slider does not.
   */
  var DRILL_LENGTHS = {
    short: {
      label: 'Under 10 min',
      match: function (m) { return m < 10; }
    },
    medium: {
      label: '10-20 min',
      match: function (m) { return m >= 10 && m <= 20; }
    },
    long: {
      label: 'Over 20 min',
      match: function (m) { return m > 20; }
    }
  };
  /**
   * Drill focus, per language.
   *
   * These were labelled once, in Swedish, and shown to English readers as
   * "Fys" and "Skott" — the same fault the weekly-goal metrics had: the
   * values are DATA, so the text-node translator cannot touch them, and a
   * single label map means one language always reads wrong.
   *
   * Unknown values fall through to the raw enum rather than a blank, so a
   * focus added server-side looks unfinished rather than missing.
   */
  var FOCUS_LABEL = {
    sv: {
      teknik: 'Teknik',
      fys: 'Fys',
      skott: 'Skott',
      passning: 'Passning',
      spelforstaelse: 'Spelförståelse'
    },
    en: {
      teknik: 'Technique',
      fys: 'Fitness',
      skott: 'Shooting',
      passning: 'Passing',
      spelforstaelse: 'Game sense'
    }
  };

  function focusLabel(focus) {
    var table = FOCUS_LABEL[effectiveLang()] || FOCUS_LABEL.en;
    return table[focus] || focus;
  }

  /** Age bands are already language-neutral ("9-11"); only the unit needs
   *  translating, and "år" was hardcoded into both render sites. */
  function ageBandLabel(band) {
    return band + (effectiveLang() === 'sv' ? ' år' : ' yrs');
  }

  function drillCard(drill) {
    return '<div class="card">' +
      '<h3 style="margin:0 0 4px;font-size:15px">' + esc(drill.title) + '</h3>' +
      '<p class="muted" style="margin:0 0 10px">' +
        esc(focusLabel(drill.focus)) + ' · ' +
        esc(ageBandLabel(drill.ageBand)) + ' · ' +
        esc(drill.durationMinutes) + ' min · ' + esc(drill.author) + '</p>' +
      '<button data-go="drill/' + esc(drill.slug) + '">Open drill</button>' +
      '</div>';
  }


  /* ---- session planner ------------------------------------------------ */

  /* Status as a coach should read it. Never the model's own words: a
   * failure here is "it did not work", not a stack trace, and the app
   * deliberately stores a fixed phrase rather than the generator's
   * error. */
  function planStatusLabel(plan) {
    if (plan.status === 'ready') return 'Ready';
    if (plan.status === 'failed') {
      return plan.failureReason || 'Could not be written this time.';
    }
    return 'Generating… this takes about a minute.';
  }

  function planRows(plans) {
    if (!plans.length) {
      return '<div class="card"><p class="muted">No sessions yet. ' +
        'Describe one above.</p></div>';
    }
    return plans.map(function (plan) {
      return '<div class="card">' +
        '<h3 style="margin:0 0 4px;font-size:15px">' +
          esc(plan.promptText) + '</h3>' +
        '<p class="muted" style="margin:0 0 10px">' +
          esc(ageBandLabel(plan.ageBand)) + ' · ' +
          esc(plan.durationMinutes) + ' min · ' +
          esc(planStatusLabel(plan)) + '</p>' +
        (plan.status === 'ready'
          ? '<button data-go="plan/' + esc(plan.id) + '">Open session</button> '
          : '') +
        '<button data-drop-plan="' + esc(plan.id) + '">Delete</button>' +
        '</div>';
    }).join('');
  }

  /* One timer at a time, cancelled on navigation. Without the guard, each
   * refresh would start another and the page would poll faster and faster
   * the longer it stayed open. */
  var planRefreshTimer = null;

  function schedulePlanRefresh() {
    if (planRefreshTimer) clearTimeout(planRefreshTimer);
    planRefreshTimer = setTimeout(function () {
      planRefreshTimer = null;
      // state.tab is the router's own record of where we are.
      // Re-rendering a page the coach has navigated away from
      // would fight their navigation.
      if (state.tab === 'plans') go('plans');
    }, 8000);
  }


  /* ---- trainer tips --------------------------------------------------- */

  function postStatusLabel(post) {
    if (post.status === 'published') return 'Live';
    if (post.status === 'rejected') {
      return post.rejectionReason || 'Not published';
    }
    return 'Waiting for review';
  }

  /* An author's own tip. Shows the rejection reason, because a rejection
   * a person cannot act on just gets resubmitted unchanged. */
  /**
   * The tip currently being previewed as a player would see it.
   *
   * Module state rather than a route parameter because the most useful
   * preview is of a tip that has no id yet — the one being typed in the
   * compose form. A route like `playerPreview/<id>` could not express
   * that without inventing a draft id or a round-trip to save one.
   */
  var previewPost = null;

  function preview(post) {
    previewPost = post;
    go('playerPreview');
  }

  /** Wires every `data-preview-post` button inside `root`. */
  function wirePostPreviews(root, posts) {
    root.querySelectorAll('[data-preview-post]').forEach(function (button) {
      button.onclick = function () {
        var id = button.getAttribute('data-preview-post');
        var found = posts.filter(function (p) { return p.id === id; })[0];
        if (found) preview(found);
      };
    });
  }

  function ownPostCard(post) {
    return '<div class="card">' +
      '<h3 style="margin:0 0 4px;font-size:15px">' + esc(post.title) + '</h3>' +
      '<p class="muted" style="margin:0 0 8px">' +
        esc(postStatusLabel(post)) + '</p>' +
      '<pre style="white-space:pre-wrap;font:inherit;margin:0 0 10px">' +
        esc(post.body) + '</pre>' +
      '<button data-preview-post="' + esc(post.id) + '">Preview as player</button> ' +
      '<button data-drop-post="' + esc(post.id) + '">Delete</button>' +
      '</div>';
  }

  /* One tip in the review queue. The body is rendered as escaped plain
   * text in a <pre> — it is text a stranger wrote and is about to be put
   * in front of children, so it is never parsed as markup. */
  /* ADR-0035 Decision 3 — say when the text started as a model draft.
   *
   * The whole reason the provenance column exists. A reviewer working a
   * queue reads human-written and machine-drafted text differently and
   * should: a person writing from experience gets things wrong in ways
   * that look wrong, and a model gets them wrong in ways that read
   * fluently. Hiding the distinction would degrade the one control
   * standing between this table and a child's screen.
   *
   * Rendered as a marker plus a sentence about what to actually do,
   * rather than a bare label. "Machine-drafted" on its own tells a
   * reviewer a fact and not a task, and at 9pm on a Sunday a fact is
   * easy to skim past. */
  function draftedMarker(post) {
    if (!post.machineDrafted) return '';
    return '<p style="margin:0 0 8px;font-size:13px;' +
      'border-left:3px solid var(--accent);padding-left:8px">' +
      '<strong>Drafted by the plan generator</strong>, then edited and ' +
      'submitted by the trainer above &mdash; who is accountable for it ' +
      'either way. Worth reading for the things a model gets confidently ' +
      'wrong: an exercise that does not suit the age band, a number of ' +
      'repetitions nobody would set, equipment a team will not have.' +
      '</p>';
  }

  /* ADR-0035 — turn a finished plan into a tip, for review.
   *
   * **The body is pre-filled with the model's text and is editable, and
   * both halves of that are deliberate.** A blank box would be honest
   * about authorship and would in practice be filled by pasting the same
   * text unchanged, having read it no more closely. Pre-filling puts the
   * words in front of the trainer in a box that invites changing them,
   * which is the behaviour actually wanted.
   *
   * What the pre-fill cannot do is make anyone read. So `wireSubmitAsPost`
   * notices when nothing was changed and asks a second time — the same
   * two-tap pattern this console already uses for deletes, and for the
   * same reason: the cost of one extra click is trivial next to the cost
   * of the thing it makes you notice.
   *
   * Age band and focus default from the plan because the plan was
   * generated for them; a trainer who wants different values can say so,
   * but re-picking what they already told the generator is friction with
   * nothing behind it. */
  function submitAsPostCard(plan) {
    return '<div class="card">' +
      '<h3 style="margin:0 0 4px;font-size:15px">Turn this into a tip</h3>' +
      '<p class="muted" style="margin:0 0 12px">Tips are read by every ' +
      'player in the app, not just your team. An admin reads it before ' +
      'anyone sees it, and they will be told it started as a machine ' +
      'draft &mdash; but your name is on it, so edit it until it is ' +
      'something you would say.</p>' +
      '<p class="muted" style="margin:0 0 12px">No links, email addresses ' +
      'or phone numbers.</p>' +
      '<label for="sapTitle">Title</label>' +
      '<input id="sapTitle" maxlength="120" autocomplete="off" ' +
        'placeholder="Fem minuter teknik hemma">' +
      '<label for="sapByline">How readers see you</label>' +
      '<input id="sapByline" maxlength="80" autocomplete="off" ' +
        'placeholder="Anna, tränare i Uppsala">' +
      '<label for="sapBody">The tip</label>' +
      '<textarea id="sapBody" rows="10" maxlength="4000">' +
        esc(plan.generatedPlan || '') + '</textarea>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' +
        '<span><label for="sapAge">Age group</label>' +
        '<select id="sapAge"><option value="">—</option>' +
          DRILL_AGE_BANDS.map(function (b) {
            return '<option value="' + esc(b) + '"' +
              (b === plan.ageBand ? ' selected' : '') + '>' +
              esc(ageBandLabel(b)) + '</option>';
          }).join('') + '</select></span>' +
        '<span><label for="sapFocus">Focus</label>' +
        '<select id="sapFocus"><option value="">—</option>' +
          DRILL_FOCUSES.map(function (f) {
            return '<option value="' + esc(f) + '"' +
              (f === plan.focus ? ' selected' : '') + '>' +
              esc(focusLabel(f)) + '</option>';
          }).join('') + '</select></span>' +
      '</div>' +
      '<p style="margin-top:12px">' +
        '<button id="sapGo" class="primary">Send for review</button></p>' +
      '<p id="sapMsg" class="muted"></p>' +
      '</div>';
  }

  function wireSubmitAsPost(plan) {
    var button = document.getElementById('sapGo');
    if (!button) return;
    var original = String(plan.generatedPlan || '').trim();

    button.onclick = function () {
      var msg = document.getElementById('sapMsg');
      var body = {
        title: document.getElementById('sapTitle').value.trim(),
        authorByline: document.getElementById('sapByline').value.trim(),
        body: document.getElementById('sapBody').value.trim(),
        ageBand: document.getElementById('sapAge').value || undefined,
        focus: document.getElementById('sapFocus').value || undefined,
        locale: effectiveLang()
      };

      if (body.title.length < 4 || body.body.length < 20 ||
          body.authorByline.length < 2) {
        msg.className = 'err';
        msg.textContent = 'A title, a byline and a few sentences, please.';
        button.removeAttribute('data-armed');
        button.textContent = 'Send for review';
        return;
      }

      /* Nothing was changed. Not blocked — a plan can be right as
       * written, and refusing would be this console deciding it knows
       * better than the trainer. Asked once, because the difference
       * between "I read it and it was good" and "I did not read it"
       * is invisible from here and enormous to the child at the end. */
      if (body.body === original && !button.getAttribute('data-armed')) {
        button.setAttribute('data-armed', '1');
        button.textContent = 'Send it unchanged';
        msg.className = 'muted';
        msg.textContent = 'This is the generated text, word for word. ' +
          'If you have read it and it is right, send it — your name goes ' +
          'on it either way.';
        return;
      }

      msg.className = 'muted';
      msg.textContent = 'Sending…';
      button.disabled = true;
      api.post('/api/v1/training-plans/' + encodeURIComponent(plan.id) +
               '/submit-as-post', body)
        .then(function () { go('posts'); })
        .catch(function (err) {
          msg.className = 'err';
          msg.textContent = errorMessage(err);
          button.disabled = false;
          button.removeAttribute('data-armed');
          button.textContent = 'Send for review';
        });
    };
  }

  function reviewCard(post, isPending) {
    return '<div class="card">' +
      '<h3 style="margin:0 0 4px;font-size:15px">' + esc(post.title) + '</h3>' +
      '<p class="muted" style="margin:0 0 8px">' + esc(post.authorByline) +
        (post.ageBand ? ' · ' + esc(ageBandLabel(post.ageBand)) : '') +
        (post.focus ? ' · ' + esc(focusLabel(post.focus)) : '') + '</p>' +
      draftedMarker(post) +
      '<pre style="white-space:pre-wrap;font:inherit;margin:0 0 12px">' +
        esc(post.body) + '</pre>' +
      // Offered to the reviewer too, and arguably this is where it earns
      // its keep: the publish decision is about what a child will see,
      // and this is the only place to see that before deciding.
      '<button data-preview-post="' + esc(post.id) + '">Preview as player</button> ' +
      (isPending
        ? '<button class="primary" data-publish="' + esc(post.id) + '">Publish</button> ' +
          '<button data-reject="' + esc(post.id) + '">Reject</button>'
        : '<button data-unpublish="' + esc(post.id) + '">Take it down</button>') +
      '</div>';
  }

  function wirePostDeletes(view, backTo) {
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-drop-post]'),
      function (button) {
        /* Two taps rather than a confirm() dialog, same as everywhere
         * else in this console. */
        button.onclick = function () {
          if (!button.getAttribute('data-armed')) {
            button.setAttribute('data-armed', '1');
            button.textContent = 'Tap again to delete';
            return;
          }
          api.del('/api/v1/trainer-posts/' +
            encodeURIComponent(button.getAttribute('data-drop-post')))
            .then(function () { go(backTo); })
            .catch(function (err) {
              button.textContent = errorMessage(err);
            });
        };
      }
    );
  }

  /* Reject and take-down both need a reason: it is what the author sees,
   * and "no" with no sentence attached is not something anyone can act
   * on. Prompt-free — a browser prompt() blocks the page the same way
   * confirm() does — so the reason comes from an input revealed in place. */
  function wireReviewButtons(view) {
    function act(button, url, needsReason, verb) {
      var id = button.getAttribute('data-publish') ||
               button.getAttribute('data-reject') ||
               button.getAttribute('data-unpublish');
      var msg = document.getElementById('reviewMsg');

      if (needsReason && !button.getAttribute('data-armed')) {
        var input = document.createElement('input');
        input.placeholder = 'Why? The author sees this.';
        input.style.marginTop = '8px';
        input.setAttribute('data-reason-for', id);
        button.parentNode.appendChild(input);
        button.setAttribute('data-armed', '1');
        button.textContent = verb + ' — tap again';
        input.focus();
        return;
      }

      var reasonField = view.querySelector('[data-reason-for="' + id + '"]');
      var reason = reasonField ? reasonField.value.trim() : '';
      if (needsReason && reason.length < 3) {
        msg.className = 'err';
        msg.textContent = 'Give the author a reason first.';
        return;
      }

      button.disabled = true;
      msg.className = 'muted';
      msg.textContent = 'Saving…';
      api.post('/api/v1/admin/trainer-posts/' + encodeURIComponent(id) + url,
               needsReason ? { reason: reason } : undefined)
        .then(function () { go('postReview'); })
        .catch(function (err) {
          button.disabled = false;
          msg.className = 'err';
          msg.textContent = errorMessage(err);
        });
    }

    Array.prototype.forEach.call(view.querySelectorAll('[data-publish]'),
      function (b) { b.onclick = function () { act(b, '/publish', false, ''); }; });
    Array.prototype.forEach.call(view.querySelectorAll('[data-reject]'),
      function (b) { b.onclick = function () { act(b, '/reject', true, 'Reject'); }; });
    Array.prototype.forEach.call(view.querySelectorAll('[data-unpublish]'),
      function (b) { b.onclick = function () { act(b, '/unpublish', true, 'Take down'); }; });
  }

  /* ---- drill groups ---------------------------------------------------
   *
   * A trainer's own shelves over the shared library. Private to whoever
   * made them: every route is scoped server-side to the calling account,
   * and there is no view here that names another trainer's groups.
   *
   * Tags are free text, which is a deliberate exception in this app. It is
   * safe HERE because nobody else can read them — if groups ever become
   * shareable, they need the fixed vocabulary every cross-visible field in
   * this project has. Written down in the entity too, so the constraint
   * survives whoever builds the sharing.
   */

  function tagChips(tags) {
    if (!tags.length) return '';
    return '<p style="margin:0 0 10px;display:flex;gap:6px;flex-wrap:wrap">' +
      tags.map(function (tag) {
        return '<span class="chip">' + esc(tag) + '</span>';
      }).join('') + '</p>';
  }

  /* "3 drills" / "1 drill", and the Swedish forms, without asking the
   * text-node translator to pluralise a number it cannot see. */
  function drillCountLabel(count) {
    if (effectiveLang() === 'sv') {
      return count + (count === 1 ? ' övning' : ' övningar');
    }
    return plural(count, 'drill');
  }


  /* ---- bug triage ----------------------------------------------------- */

  var BUG_STATUSES = ['open', 'triaged', 'closed'];
  var BUG_STATUS_LABEL = { open: 'Open', triaged: 'Triaged', closed: 'Closed' };
  var BUG_STATUS_CLASS = { open: 'warn', triaged: 'accent', closed: 'ok' };

  function countSuffix(counts) {
    var total = BUG_STATUSES.reduce(function (sum, st) {
      return sum + (typeof counts[st] === 'number' ? counts[st] : 0);
    }, 0);
    return total ? ' (' + total + ')' : '';
  }

  function bugRow(row) {
    var reporter = row.reporter
      ? esc(row.reporter.screenName) + '<br><span class="muted">' +
        esc(row.reporter.teamName) + '</span>'
      /* The reporter's row is gone — an erasure takes their reports with
       * it, so this is a referential edge rather than an error. */
      : '<span class="muted">no longer on the app</span>';

    return '<tr><td>' + esc((row.createdAt || '').slice(0, 10)) + '</td><td>' +
      reporter + '</td><td>' + esc(row.screen) + '</td><td>' +
      esc(row.category.replace(/_/g, ' ')) +
      (row.description ? '<br><span class="muted">' + esc(row.description) +
        '</span>' : '') +
      '</td><td class="muted">' + esc(row.platform) + ' ' + esc(row.appVersion) +
      (row.osVersion ? '<br>' + esc(row.osVersion) : '') + '</td><td>' +
      '<span class="badge ' + (BUG_STATUS_CLASS[row.status] || '') + '">' +
      esc(row.status) + '</span></td><td style="text-align:right;white-space:nowrap">' +
      BUG_STATUSES.filter(function (st) { return st !== row.status; })
        .map(function (st) {
          return '<button data-bug="' + esc(row.id) + '" data-status="' +
            st + '">' + esc(BUG_STATUS_LABEL[st]) + '</button> ';
        }).join('') +
      '</td></tr>';
  }

  function wireBugButtons(view, filter) {
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-bug]'),
      function (button) {
        button.onclick = function () {
          var was = button.textContent;
          button.disabled = true;
          button.textContent = '…';
          api.patch('/api/v1/admin/bug-reports/' +
                    encodeURIComponent(button.getAttribute('data-bug')),
                    { status: button.getAttribute('data-status') })
            .then(function () { go(filter ? 'bugs/' + filter : 'bugs'); })
            .catch(function (e) {
              button.disabled = false;
              button.textContent = was;
              alertInline(button, errorMessage(e));
            });
        };
      }
    );
  }

  /* ---- statistics rendering ------------------------------------------ */

  /** A hover/focus explainer. The marker is a real button so it is
   *  keyboard reachable, not a span with a title attribute. */
  function info(text) {
    return '<span class="info"><button type="button" aria-label="What is this?">i</button>' +
      '<span role="tooltip">' + esc(text) + '</span></span>';
  }

  function pct(value) {
    return typeof value === 'number' ? Math.round(value) + '%' : '—';
  }

  function row(label, value, explain) {
    return '<tr><td>' + esc(label) + (explain ? info(explain) : '') +
      '</td><td style="text-align:right"><strong>' + value + '</strong></td></tr>';
  }

  /** Every enum value is always present in the payload, including zeros —
   *  an absent key would be ambiguous between "none" and "not measured". */
  function statusRows(label, byStatus) {
    if (!byStatus) return '';
    return Object.keys(byStatus).map(function (key, index) {
      return row((index === 0 ? label + ': ' : '') + key.replace(/_/g, ' '),
                 esc(byStatus[key]), null);
    }).join('');
  }

  function histogramCard(title, bars, explain) {
    if (!bars || !bars.length) return '';
    var max = Math.max.apply(null, bars.map(function (b) { return b.count; })) || 1;
    return '<div class="card"><h3 style="margin:0 0 10px;font-size:15px">' +
      esc(title) + info(explain) + '</h3>' +
      bars.map(function (bar) {
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">' +
          '<span style="width:88px;font-size:13px">' + esc(bar.bucket) + '</span>' +
          '<span style="flex:1;background:var(--bg);border-radius:4px;height:14px;overflow:hidden">' +
            '<span style="display:block;height:100%;width:' +
            ((bar.count / max) * 100).toFixed(1) + '%;background:var(--accent)"></span></span>' +
          '<strong style="width:44px;text-align:right;font-size:13px">' +
            esc(bar.count) + '</strong></div>';
      }).join('') + '</div>';
  }

  function listCard(title, entries, toCells, explain) {
    if (!entries || !entries.length) return '';
    return '<div class="card"><h3 style="margin:0 0 10px;font-size:15px">' +
      esc(title) + info(explain) + '</h3><table>' +
      entries.map(function (entry) {
        var cells = toCells(entry);
        return '<tr><td>' + cells[0] + '</td><td style="text-align:right">' +
          '<strong>' + cells[1] + '</strong></td></tr>';
      }).join('') + '</table></div>';
  }

  function weeklyCard(title, weeks) {
    if (!weeks || !weeks.length) return '';
    return '<div class="card"><h3 style="margin:0 0 8px;font-size:15px">' +
      esc(title) + '</h3>' +
      lineChart(weeks.map(function (w) {
        return { day: w.weekStart || w.week || '', value: w.count ?? 0 };
      }), title + ' per week') + '</div>';
  }

  /**
   * Says which of ADR-0020's two very different situations produced an
   * empty breakdown. Without this the console cannot tell "every group was
   * withheld by the floor" from "there are no teams" — opposite facts an
   * operator acts on differently.
   */
  function bucketNote(metric, floor) {
    if (!metric) return '';
    if (metric.byTeamSizeBucket && metric.byTeamSizeBucket.length) return '';
    return '<p class="muted" style="margin:12px 0 0">' +
      (metric.foldedIntoAppWide
        ? 'Not broken out by team size this period — no group had ' +
          esc(floor) + ' teams in it, so they are all counted in the ' +
          'app-wide figures above. Nothing was dropped.'
        : 'No teams to break out yet.') + '</p>';
  }


  /* ---- language -------------------------------------------------------
   *
   * The console shipped English-only, which is fine for the operator and
   * wrong for the people it was built for: SkillStreak's trainers are
   * Swedish youth-floorball coaches, and the trainer surface is the half
   * they live in.
   *
   * Keyed by the English source string, exactly like site/i18n.js — the
   * views are built as HTML strings, so a key-per-string scheme would mean
   * touching every line and a missing key would render an identifier to a
   * coach. Falling back to English is visible and honest instead.
   *
   * Only the TRAINER surface is translated. The admin pillars are the
   * project owner's own tooling, full of terms that have no settled
   * Swedish ("suppression floor", "step-up") and would read worse
   * translated than left alone. Said out loud so the gap looks deliberate
   * rather than unfinished.
   */
  var LANG_KEY = 'skillstreak.console.lang';

  /**
   * Keys are matched against whole text nodes, so a key that is also a
   * plausible piece of SERVER DATA would rewrite it. A child's screen name
   * is the one string in this app that must render exactly as they chose
   * it, so bare generic words — "Open", "All", "Player", "Training",
   * "Trainer", "of", "min" — were removed after a review pointed out that
   * a screen name equal to any of them would be translated.
   *
   * Every key below is either a full sentence or a phrase no screen name,
   * team name or drill title would plausibly be. Where a short word was
   * genuinely needed in the copy, the view wraps it in its own <span> with
   * a longer, unambiguous key rather than a bare word.
   */
  var SV = {
    /* nav */
    'My teams': 'Mina lag',
    'Drill library': 'Övningsbank',
    'Search by name': 'Sök på namn',
    'All focuses': 'Alla områden',
    'Open drill': 'Öppna övningen',
    'Any length': 'Valfri längd',
    'Under 10 min': 'Under 10 min',
    '10-20 min': '10–20 min',
    'Over 20 min': 'Över 20 min',
    'Nothing matches that.': 'Inget matchar det.',
    'My teams': 'Mina lag',
    /* teams / PT1 */
    'Add a team': 'Lägg till ett lag',
    'A captain generates an 8-character code and gives it to you. You cannot search for teams — the invitation only ever travels in that direction.':
      'En lagkapten skapar en kod på 8 tecken och ger den till dig. Du kan inte söka efter lag — inbjudan går alltid åt det hållet.',
    'Redeem code': 'Använd kod',
    'No teams yet. Redeem a code above to get started.':
      'Inga lag än. Använd en kod ovan för att komma igång.',
    'Open team': 'Öppna laget',
    'A team code is exactly 8 characters.': 'En lagkod är exakt 8 tecken.',
    'Redeeming…': 'Använder koden…',
    /* team detail / PT2 */
    'points in the team pot': 'poäng i lagets pott',
    'This week': 'Den här veckan',
    'No weekly goal running.': 'Inget veckomål igång.',
    'Screen names only. You see a player’s training after their family says yes — each child is a separate decision.':
      'Bara skärmnamn. Du ser en spelares träning först när familjen sagt ja — varje barn är ett eget beslut.',
    'Access': 'Åtkomst',
    'Shared with you': 'Delas med dig',
    'Waiting for a parent': 'Väntar på förälder',
    'Not shared': 'Delas inte',
    'View training': 'Se träningen',
    'Ask for access': 'Be om åtkomst',
    'Send the email again': 'Skicka mejlet igen',
    'Sending…': 'Skickar…',
    'Sent again': 'Skickat igen',
    'Asked — it is their decision': 'Frågad — det är deras beslut',
    'Asking…': 'Frågar…',
    'You are not linked to this team.': 'Du är inte kopplad till det här laget.',
    'A captain can revoke a trainer link at any time, and does not have to give a reason.':
      'En lagkapten kan ta bort en tränarkoppling när som helst, utan att förklara varför.',
    'players on the roster': 'spelare i truppen',
    'Players in this team': 'Spelare i laget',
    'out of': 'av',
    'ending on': 'slutar',
    'shared with you': 'delas med dig',
    'waiting for a parent': 'väntar på förälder',
    /* player detail */
    'When': 'När',
    'Activity': 'Aktivitet',
    'Minutes': 'Minuter',
    'Nothing logged yet.': 'Inget loggat än.',
    'No badges yet.': 'Inga märken än.',
    'No real name, no contact details, no clips, no chat, and nowhere this player has been. That is the whole of what a trainer is shown.':
      'Inget riktigt namn, inga kontaktuppgifter, inga klipp, ingen chatt, och aldrig var spelaren har varit. Det är allt en tränare ser.',
    /* drills */
    'Coach-authored training material. It carries no clips, no training logs and no player data — drills are files in the repository, read by a person before they merge.':
      'Träningsmaterial skrivet av tränare. Det innehåller inga klipp, inga träningsloggar och inga spelaruppgifter — övningarna är filer som en människa läser innan de publiceras.',
    'Nothing here yet. Drills are added to the repository and arrive with the next release.':
      'Inget här än. Övningar läggs till i repot och dyker upp vid nästa release.',
    /* trainer tips */
    'My tips': 'Mina tips',
    'Tip review': 'Granska tips',
    'Write something useful for players and coaches. An admin reads every tip before anyone sees it.':
      'Skriv något användbart för spelare och tränare. En administratör läser varje tips innan någon ser det.',
    'You can say who you are and where you coach. You cannot include links, email addresses or phone numbers.':
      'Du får berätta vem du är och var du tränar. Du får inte ha med länkar, mejladresser eller telefonnummer.',
    'Title': 'Rubrik',
    'How readers see you': 'Så syns du för läsarna',
    'The tip': 'Tipset',
    'Send for review': 'Skicka för granskning',
    'A title, a byline and a few sentences, please.': 'En rubrik, en avsändare och några meningar, tack.',
    'No tips yet.': 'Inga tips än.',
    'Waiting for review': 'Väntar på granskning',
    'Not published': 'Inte publicerat',
    'Live': 'Publicerat',
    'Every tip is read here before players can see it. There is no automatic check — you are it.':
      'Varje tips läses här innan spelare kan se det. Det finns ingen automatisk kontroll — det är du som är kontrollen.',
    'Waiting for review': 'Väntar på granskning',
    'Nothing waiting.': 'Inget väntar.',
    'Live now': 'Publicerat nu',
    'Nothing published yet.': 'Inget publicerat än.',
    'Publish': 'Publicera',
    'Reject': 'Avvisa',
    'Take it down': 'Ta ner det',
    'Why? The author sees this.': 'Varför? Skribenten ser det här.',
    'Give the author a reason first.': 'Ge skribenten en anledning först.',
    'Saving…': 'Sparar…',
    /* session planner */
    'Session planner': 'Passplaneraren',
    'Describe the session you want and it is written from the drill library. It takes about a minute. Read it before you use it — it is a draft, not a coach.':
      'Beskriv passet du vill ha så skrivs det utifrån övningsbanken. Det tar ungefär en minut. Läs igenom det innan du använder det — det är ett utkast, inte en tränare.',
    'What kind of session?': 'Vilken typ av pass?',
    'Describe the session, not the players — do not write anyone\'s name here.':
      'Beskriv passet, inte spelarna — skriv inte någons namn här.',
    'Delete': 'Ta bort',
    'Tap again to delete': 'Tryck igen för att ta bort',
    'kul pass med mycket rörelse': 'kul pass med mycket rörelse',
    'Age group': 'Åldersgrupp',
    'Minutes': 'Minuter',
    'Focus': 'Fokus',
    'Write the session': 'Skriv passet',
    'Describe the session in a few words first.': 'Beskriv passet med några ord först.',
    'Sending…': 'Skickar…',
    'No sessions yet. Describe one above.': 'Inga pass än. Beskriv ett ovan.',
    'Generating… this takes about a minute.': 'Skriver… det tar ungefär en minut.',
    'Could not be written this time.': 'Kunde inte skrivas den här gången.',
    'Ready': 'Klart',
    'Open session': 'Öppna passet',
    'A draft — read it before you use it.': 'Ett utkast — läs igenom innan du använder det.',
    /* clip tagging */
    'AI health': 'AI-status',
    'Session planner stats unavailable.': 'Statistik för passplaneraren är inte tillgänglig.',
    'Sessions written': 'Skrivna pass',
    'Failed': 'Misslyckade',
    'Queue empty.': 'Kön är tom.',
    'Clip tagging': 'Klippmärkning',
    'How the automatic training-type tagger is doing, across every published clip. Counts only — this page cannot show which clip, which team or which player, and has no filter that could.':
      'Hur den automatiska märkningen av träningstyp fungerar, över alla publicerade klipp. Bara antal — sidan kan inte visa vilket klipp, vilket lag eller vilken spelare, och har inget filter som skulle kunna det.',
    'Published clips': 'Publicerade klipp',
    'Looked at': 'Granskade',
    'Waiting': 'Väntar',
    'Gave up': 'Gav upp',
    'Declined to tag': 'Avstod från att märka',
    'Nothing processed yet. This stays blank rather than showing 0%, because "nothing has run" and "it tags everything" are opposite findings.':
      'Inget behandlat än. Detta lämnas tomt i stället för att visa 0 %, eftersom "inget har körts" och "allt märks" är motsatta resultat.',
    'What it found': 'Vad den hittade',
    'Tag': 'Märkning',
    'Clips': 'Klipp',
    'Avg confidence': 'Snittsäkerhet',
    'No tags stored yet.': 'Inga märkningar sparade än.',
    'Produced by': 'Skapad av',
    'Nothing yet.': 'Inget än.',
    /* drill groups */
    'All groups': 'Alla grupper',
    'Manage groups': 'Hantera grupper',
    'Your drill groups': 'Dina övningsgrupper',
    'Your own shelves over the shared library. Only you can see them. Deleting a group never deletes a drill.':
      'Dina egna hyllor i det gemensamma biblioteket. Bara du ser dem. Att ta bort en grupp tar aldrig bort en övning.',
    'Group name': 'Gruppnamn',
    'Tags, separated by commas': 'Taggar, separerade med komma',
    'Warm-up': 'Uppvärmning',
    'indoors, short, u11': 'inomhus, kort, u11',
    'Create group': 'Skapa grupp',
    'Save changes': 'Spara ändringar',
    'Cancel': 'Avbryt',
    'Rename or retag': 'Byt namn eller taggar',
    'Delete group': 'Ta bort grupp',
    'Tap again to delete': 'Tryck igen för att ta bort',
    'No groups yet. Make one above, then add drills to it from any drill.':
      'Inga grupper än. Skapa en ovan och lägg sedan till övningar från valfri övning.',
    'A group needs a name.': 'En grupp behöver ett namn.',
    'Your groups': 'Dina grupper',
    'Save groups': 'Spara grupper',
    'You have no groups yet.': 'Du har inga grupper än.',
    'Make one': 'Skapa en',
    'to start organising the library your way.':
      'för att börja ordna biblioteket som du vill.',
    'Saved.': 'Sparat.',
    'Saving…': 'Sparar…',
    /* shared */
    'Loading…': 'Laddar…',
    'Sign out': 'Logga ut',
    'ending': 'slutar',
    'år': 'år'
  };

  function readLang() {
    try {
      var stored = localStorage.getItem(LANG_KEY);
      if (stored === 'sv' || stored === 'en') return stored;
    } catch (e) { /* private mode */ }
    /* Trainers default to Swedish, the operator to English — the roles
     * genuinely read different languages, and defaulting on role is
     * kinder than making every coach find a toggle. */
    return state.role === 'pt' ? 'sv' : 'en';
  }

  /** The language actually in force: Swedish only on the trainer surface,
   *  whatever is stored. An admin who once picked SV as a trainer should
   *  not get a half-Swedish admin console back. */
  function effectiveLang() {
    return state.mode === 'pt' ? state.lang : 'en';
  }

  function setLang(lang) {
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
    state.lang = lang;
    go(state.tab);
  }

  /** Translate. Untranslated strings fall through as English, which is
   *  visible and honest rather than a blank or an identifier. */
  function t(text) {
    if (effectiveLang() !== 'sv') return text;
    return SV[text] || text;
  }

  /**
   * Translates a rendered subtree in place, by text node.
   *
   * The first attempt routed translation through esc(), which was exactly
   * backwards: esc() only receives DYNAMIC values — team names, screen
   * names, numbers — which are the strings that must never be translated,
   * while the static copy sits inline in template literals and never
   * passes through it at all. The nav translated and nothing else did.
   *
   * Walking text nodes after render is what site/i18n.js already does, for
   * the same reason: the views are HTML strings, and a key-per-string
   * scheme would mean touching every line of every view.
   *
   * Matching on the trimmed source string makes untranslatable content
   * safe by construction — a Swedish team name matches no key and is left
   * alone. Whitespace is preserved around the replacement so layout does
   * not shift.
   */
  function translateTree(root) {
    if (!root || effectiveLang() !== 'sv') return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue;
      var trimmed = raw.trim();
      if (!trimmed) continue;
      var translated = SV[trimmed];
      if (translated && translated !== trimmed) {
        node.nodeValue = raw.replace(trimmed, translated);
      }
    }

    /* Placeholders are attributes, not text nodes, so the walk above never
     * saw them — 'Search by name' sat translated-but-unused in SV from the
     * day the drill search shipped, and Swedish readers got an English
     * placeholder under Swedish buttons.
     *
     * Only exact dictionary hits are replaced, same rule as the text
     * walk, so an untranslated placeholder stays readable rather than
     * blanking. */
    Array.prototype.forEach.call(
      root.querySelectorAll('[placeholder]'),
      function (field) {
        var translated = SV[field.getAttribute('placeholder')];
        if (translated) field.setAttribute('placeholder', translated);
      }
    );
  }

  /* ---- campaigns ----------------------------------------------------- */

  function tile(value, label) {
    return '<div class="tile"><span class="n">' + esc(value) +
      '</span><span class="l">' + esc(label) + '</span></div>';
  }

  var CHANNEL_LABEL = {
    linkedin: 'LinkedIn', facebook: 'Facebook', instagram: 'Instagram',
    email: 'Email', other: 'Other'
  };
  var AUDIENCE_LABEL = {
    general: 'General', investors: 'Investors',
    contributors: 'Contributors', trainers: 'Trainers'
  };
  var STATUS_CLASS = {
    draft: '', scheduled: 'warn', posted: 'ok', archived: ''
  };

  function campaignRow(row) {
    return '<tr><td>' + esc(row.name) +
      (row.plannedFor ? '<br><span class="muted">' + esc(row.plannedFor) + '</span>' : '') +
      '</td><td><code>' + esc(row.tag) + '</code></td><td>' +
      esc(CHANNEL_LABEL[row.channel] || row.channel) + '</td><td>' +
      esc(AUDIENCE_LABEL[row.audience] || row.audience) + '</td><td>' +
      esc(row.locale) + '</td><td><span class="badge ' +
      (STATUS_CLASS[row.status] || '') + '">' + esc(row.status) +
      '</span></td><td><strong>' + esc(row.signups) + '</strong></td>' +
      '<td style="text-align:right;white-space:nowrap">' +
      '<button data-edit="' + esc(row.id) + '">Edit</button> ' +
      '<button data-drop="' + esc(row.id) + '">Delete</button></td></tr>';
  }

  function option(value, label, selected) {
    return '<option value="' + esc(value) + '"' +
      (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  /* One form for create and edit. `existing` null means create. */
  function showCampaignForm(existing) {
    var box = document.getElementById('campaignForm');
    var e = existing || {};
    box.style.display = '';
    box.innerHTML =
      '<div style="display:grid;gap:10px;max-width:520px">' +
        '<label>Name<input id="cName" maxlength="120" value="' + esc(e.name || '') + '"></label>' +
        '<label>Tag <span class="muted">— becomes ?campaign=&lt;tag&gt;</span>' +
          '<input id="cTag" maxlength="64" placeholder="li-sv-sommar" value="' + esc(e.tag || '') + '"></label>' +
        '<label>Channel<select id="cChannel">' +
          Object.keys(CHANNEL_LABEL).map(function (k) {
            return option(k, CHANNEL_LABEL[k], e.channel);
          }).join('') + '</select></label>' +
        '<label>Audience<select id="cAudience">' +
          Object.keys(AUDIENCE_LABEL).map(function (k) {
            return option(k, AUDIENCE_LABEL[k], e.audience);
          }).join('') + '</select></label>' +
        '<label>Language<select id="cLocale">' +
          option('sv', 'Svenska', e.locale) + option('en', 'English', e.locale) +
          '</select></label>' +
        '<label>Status<select id="cStatus">' +
          ['draft', 'scheduled', 'posted', 'archived'].map(function (k) {
            return option(k, k, e.status);
          }).join('') + '</select></label>' +
        '<label>Planned for<input id="cPlanned" type="date" value="' + esc(e.plannedFor || '') + '"></label>' +
        '<label>Where it was posted (URL)<input id="cUrl" maxlength="500" value="' + esc(e.postedUrl || '') + '"></label>' +
        '<label>Post copy<textarea id="cBody" rows="6">' + esc(e.body || '') + '</textarea></label>' +
        '<div><button id="cSave" class="primary">' +
          (existing ? 'Save changes' : 'Create campaign') + '</button> ' +
          '<button id="cCancel">Cancel</button></div>' +
        '<p id="cMsg" class="muted" style="margin:0"></p>' +
      '</div>';

    document.getElementById('cCancel').onclick = function () {
      box.style.display = 'none';
      box.innerHTML = '';
    };

    document.getElementById('cSave').onclick = function () {
      var msg = document.getElementById('cMsg');
      var body = {
        name: document.getElementById('cName').value.trim(),
        tag: document.getElementById('cTag').value.trim().toLowerCase(),
        channel: document.getElementById('cChannel').value,
        audience: document.getElementById('cAudience').value,
        locale: document.getElementById('cLocale').value,
        status: document.getElementById('cStatus').value,
        body: document.getElementById('cBody').value.trim() || undefined,
        plannedFor: document.getElementById('cPlanned').value || undefined,
        postedUrl: document.getElementById('cUrl').value.trim() || undefined
      };
      if (!body.name || !body.tag) {
        msg.className = 'err';
        msg.textContent = 'A name and a tag are both needed.';
        return;
      }
      msg.className = 'muted';
      msg.textContent = 'Saving…';
      var request = existing
        ? api.patch('/api/v1/admin/pr-campaigns/' + encodeURIComponent(existing.id), body)
        : api.post('/api/v1/admin/pr-campaigns', body);
      request.then(function () { go('campaigns'); })
        .catch(function (err) {
          msg.className = 'err';
          msg.textContent = errorMessage(err);
        });
    };
  }

  function wireCampaignButtons(view, rows) {
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-edit]'),
      function (button) {
        button.onclick = function () {
          var id = button.getAttribute('data-edit');
          showCampaignForm(rows.filter(function (r) { return r.id === id; })[0]);
          document.getElementById('campaignForm').scrollIntoView({ block: 'nearest' });
        };
      }
    );
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-drop]'),
      function (button) {
        button.onclick = function () {
          button.disabled = true;
          button.textContent = 'Deleting…';
          api.del('/api/v1/admin/pr-campaigns/' +
                  encodeURIComponent(button.getAttribute('data-drop')))
            .then(function () { go('campaigns'); })
            .catch(function (e) {
              button.disabled = false;
              button.textContent = 'Delete';
              alertInline(button, errorMessage(e));
            });
        };
      }
    );
  }

  /* ---- charts -------------------------------------------------------
   *
   * Hand-drawn inline SVG. The console has no bundler and the deployment
   * blocks external scripts, so a charting library is not available — and
   * for two chart types it would be more dependency than drawing.
   *
   * Both use a 0-based y-axis on purpose. A chart that starts the axis at
   * the minimum value makes a flat week look like a rally, which is the
   * single easiest way to mislead yourself with your own numbers.
   */
  var CHART_W = 640;
  var CHART_H = 160;
  var CHART_PAD = { top: 10, right: 8, bottom: 22, left: 34 };

  function niceMax(value) {
    if (value <= 5) return 5;
    var magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    return Math.ceil(value / magnitude) * magnitude;
  }

  function lineChart(points, label) {
    if (!points.length) return '<p class="muted">No data yet.</p>';
    var max = niceMax(Math.max.apply(null, points.map(function (p) { return p.value; })) || 1);
    var innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
    var innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
    var stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

    var coords = points.map(function (point, index) {
      return {
        x: CHART_PAD.left + index * stepX,
        y: CHART_PAD.top + innerH - (point.value / max) * innerH,
        point: point
      };
    });

    var path = coords.map(function (c, i) {
      return (i === 0 ? 'M' : 'L') + c.x.toFixed(1) + ' ' + c.y.toFixed(1);
    }).join(' ');
    var area = path + ' L' + coords[coords.length - 1].x.toFixed(1) + ' ' +
      (CHART_PAD.top + innerH) + ' L' + coords[0].x.toFixed(1) + ' ' +
      (CHART_PAD.top + innerH) + ' Z';

    /* <title> per point rather than a hover script: it is the browser's own
     * tooltip, works on keyboard focus, and needs no event wiring. */
    var dots = coords.map(function (c) {
      return '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) +
        '" r="2.5" fill="var(--accent)"><title>' + esc(c.point.day) + ': ' +
        esc(c.point.value) + '</title></circle>';
    }).join('');

    return '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" width="100%" ' +
      'role="img" aria-label="' + esc(label) + '" style="display:block">' +
      '<line x1="' + CHART_PAD.left + '" y1="' + (CHART_PAD.top + innerH) +
        '" x2="' + (CHART_W - CHART_PAD.right) + '" y2="' + (CHART_PAD.top + innerH) +
        '" stroke="var(--line)"/>' +
      '<text x="2" y="' + (CHART_PAD.top + 4) + '" font-size="10" fill="var(--muted)">' + esc(max) + '</text>' +
      '<text x="2" y="' + (CHART_PAD.top + innerH) + '" font-size="10" fill="var(--muted)">0</text>' +
      '<path d="' + area + '" fill="var(--accent)" opacity="0.12"/>' +
      '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' +
      dots +
      '<text x="' + CHART_PAD.left + '" y="' + (CHART_H - 6) + '" font-size="10" fill="var(--muted)">' +
        esc(points[0].day) + '</text>' +
      '<text x="' + (CHART_W - CHART_PAD.right) + '" y="' + (CHART_H - 6) +
        '" font-size="10" fill="var(--muted)" text-anchor="end">' +
        esc(points[points.length - 1].day) + '</text>' +
      '</svg>';
  }

  function barChart(entries, label) {
    if (!entries.length) return '<p class="muted">No clicks recorded yet.</p>';
    var max = niceMax(Math.max.apply(null, entries.map(function (e) { return e.value; })) || 1);
    return '<div role="img" aria-label="' + esc(label) + '">' +
      entries.map(function (entry) {
        var pct = (entry.value / max) * 100;
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">' +
          '<span style="width:150px;font-size:13px">' + esc(entry.label) + '</span>' +
          '<span style="flex:1;background:var(--bg);border-radius:4px;height:16px;overflow:hidden">' +
            '<span style="display:block;height:100%;width:' + pct.toFixed(1) +
            '%;background:var(--accent)"></span></span>' +
          '<strong style="width:52px;text-align:right;font-size:13px">' + esc(entry.value) + '</strong>' +
          '</div>';
      }).join('') + '</div>';
  }

  var SITE_LOCALE_LABEL = { sv: 'Swedish', en: 'English' };

  /* Seconds -> "2 min 05 s". Rendered rather than raw because an operator
   * reading "137" has to do the arithmetic every time, and the number is
   * meant to be glanceable. Null means nothing reported a duration yet —
   * shown as an em dash rather than "0 s", which would read as "people
   * leave instantly" when it actually means "we have not measured". */
  function dwellLabel(seconds) {
    if (seconds === null || seconds === undefined) return '—';
    var s = Number(seconds);
    if (!isFinite(s) || s < 0) return '—';
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    var rest = s % 60;
    return m + ' min ' + (rest < 10 ? '0' : '') + rest + ' s';
  }

  var LINK_LABEL = {
    demo_signup: 'Demo signup',
    try_it: 'Try it in browser',
    get_app: 'Get the app',
    trainers: 'Trainers page',
    coaches_section: 'Coaches section',
    github: 'GitHub',
    other: 'Other'
  };

  var VIEWS = {
    /* Wired end to end, to prove the shell actually authenticates and
     * reads real data rather than only looking like it does. */
    /* Statistics — ADR-0020's usage metrics, rendered.
     *
     * This used to print every top-level NUMBER in the payload, which was
     * exactly two config values (windowDays, minTeamsPerBucket) and none
     * of the actual metrics, since all of those are nested. So the tab
     * showed its own settings and called it statistics.
     *
     * Every figure here is app-wide. There is no team or player dimension
     * in the payload to render even if this file wanted one. */
    stats: function (view) {
      api.get('/api/v1/admin/usage-metrics').then(function (m) {
        var funnel = (m.adoptionFunnel || {}).appWide || {};
        var recency = m.activityRecency || {};
        var streaks = m.streakHealth || {};
        var goals = (m.weeklyGoalEngagement || {}).appWide || {};
        var pot = m.teamPoolGrowth || {};

        view.innerHTML =
          '<h2>Statistics</h2>' +

          '<div class="tiles">' +
            tile(funnel.totalPlayers ?? 0, 'players in total') +
            tile(recency.playersActiveLast7Days ?? 0, 'active last 7 days') +
            tile(pct(recency.percentActiveInWindow), 'active this window') +
            tile(pct(funnel.percentWithAtLeastOneTrainingLog),
                 'have ever logged') +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 10px;font-size:15px">How this report is scoped' +
              info('The window is how far back every figure below looks. ' +
                   'Nothing here is per-team or per-player — the payload has ' +
                   'no such dimension to render.') +
            '</h3>' +
            '<table>' +
              row('Window', esc(m.windowDays) + ' days',
                  'How many days back these figures cover. Changing it ' +
                  'changes every number on this page.') +
              row('Generated', esc((m.generatedAt || '').slice(0, 16).replace('T', ' ')),
                  'When this snapshot was computed. It is not live — the ' +
                  'report is produced on a schedule.') +
              row('Suppression floor', esc(m.minTeamsPerBucket) + ' teams',
                  'The privacy floor. A team-size group is only broken out ' +
                  'separately once it contains at least this many teams — ' +
                  'below that, those teams are counted in the app-wide ' +
                  'number only, never dropped. It stops a figure about "the ' +
                  'one 8-player team" from being a figure about that team.') +
            '</table>' +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 10px;font-size:15px">Getting started' +
              info('Where accounts sit in the funnel from created, through ' +
                   'a parent approving, to actually training.') +
            '</h3>' +
            '<table>' +
              row('Players', esc(funnel.totalPlayers ?? 0), null) +
              row('Have logged at least once',
                  esc(funnel.playersWithAtLeastOneTrainingLog ?? 0) +
                  ' (' + pct(funnel.percentWithAtLeastOneTrainingLog) + ')',
                  'The number that matters most early on: an account that ' +
                  'never logs anything is a signup, not a user.') +
              statusRows('Parental consent', funnel.playersByParentalConsentStatus) +
              statusRows('Team join', funnel.playersByTeamJoinStatus) +
            '</table>' +
            bucketNote(m.adoptionFunnel, m.minTeamsPerBucket) +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 10px;font-size:15px">Still coming back' +
              info('Activity recency. "This window" uses the same window as ' +
                   'the rest of the report, so it moves if the window does.') +
            '</h3>' +
            '<table>' +
              row('Active last 7 days',
                  esc(recency.playersActiveLast7Days ?? 0) + ' (' +
                  pct(recency.percentActiveLast7Days) + ')', null) +
              row('Active this window',
                  esc(recency.playersActiveInWindow ?? 0) + ' (' +
                  pct(recency.percentActiveInWindow) + ')', null) +
            '</table>' +
          '</div>' +

          histogramCard('Current streaks', streaks.currentStreakHistogram,
            'How many players sit at each streak length right now. A pile-up ' +
            'at zero means people are starting and stopping.') +
          histogramCard('Longest streaks ever', streaks.longestStreakHistogram,
            'The best each player has ever reached — it only goes up, so it ' +
            'shows what the app has managed at its best.') +

          '<div class="card">' +
            '<h3 style="margin:0 0 10px;font-size:15px">Weekly goals' +
              info('Counted per goal that ran to the end of its own week ' +
                   'without being cancelled. Cancellations are shown ' +
                   'separately on purpose — otherwise cancelling every goal ' +
                   'that was going badly would make the completion rate look ' +
                   'better.') +
            '</h3>' +
            '<table>' +
              row('Goals concluded', esc(goals.concludedGoalCount ?? 0), null) +
              row('Completed', esc(goals.completedGoalCount ?? 0) + ' (' +
                  pct(goals.percentCompleted) + ')', null) +
              row('Cancelled', esc(goals.cancelledGoalCount ?? 0),
                  'Excluded from the rate above, never hidden.') +
            '</table>' +
            bucketNote(m.weeklyGoalEngagement, m.minTeamsPerBucket) +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 10px;font-size:15px">Team pots' +
              info('The median rather than the average, so one unusually ' +
                   'busy team does not move the number.') +
            '</h3>' +
            '<table>' +
              row('Active pots', esc(pot.activePotCount ?? 0), null) +
              row('Median points per week', esc(pot.medianPointsPerWeek ?? 0), null) +
            '</table>' +
          '</div>' +

          listCard('What they train', m.trainingTypeMix, function (e) {
            return [esc(e.activityType), esc(e.logCount) + ' (' +
                    pct(e.percentOfLogs) + ')'];
          }, 'Share of all logged sessions by activity type.') +

          listCard('Badges awarded', m.badgeMix, function (e) {
            return [esc(e.badgeKey || e.badgeId), esc(e.awardCount)];
          }, 'Which badges are actually being earned. A badge nobody earns ' +
             'is either too hard or invisible.') +

          weeklyCard('Clips uploaded', (m.socialUsage || {}).clipUploadsPerWeek) +
          weeklyCard('Chat messages', (m.socialUsage || {}).chatMessagesPerWeek) +

          '<p class="muted">Aggregates only. ADR-0020 keeps a floor under ' +
          'every breakdown so no figure can resolve to a single team or ' +
          'child — which is why some sections say a group was folded into ' +
          'the app-wide number instead of being shown separately.</p>';
      }).catch(function (e) { fail(view, e); });
    },

    /* PR campaigns — the execution record for the copy in
     * docs/CAMPAIGNS.md, with each campaign's signups counted by its tag.
     *
     * Campaigns that produced nothing still show, with a 0. Hiding them
     * would make the board a list of successes, and the ones that brought
     * nobody are exactly the ones worth looking at. */
    campaigns: function (view) {
      api.get('/api/v1/admin/pr-campaigns').then(function (rows) {
        var posted = rows.filter(function (r) { return r.status === 'posted'; });
        var signups = rows.reduce(function (n, r) { return n + r.signups; }, 0);

        view.innerHTML =
          '<h2>Campaigns</h2>' +
          '<div class="tiles">' +
            tile(rows.length, plural(rows.length, 'campaign')) +
            tile(posted.length, 'posted') +
            tile(signups, 'signups attributed') +
          '</div>' +
          '<div class="card">' +
            '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' +
              '<button id="newCampaign" class="primary">New campaign</button>' +
              '<span class="muted" style="flex:1;min-width:220px">Copy for all ' +
              'four audiences lives in docs/CAMPAIGNS.md — this tracks what ' +
              'actually went out.</span>' +
            '</div>' +
            '<div id="campaignForm" style="display:none;margin-top:16px"></div>' +
          '</div>' +
          '<div class="card">' +
            (rows.length
              ? '<table><tr><th>Campaign</th><th>Tag</th><th>Channel</th>' +
                '<th>Audience</th><th>Lang</th><th>Status</th><th>Signups</th>' +
                '<th></th></tr>' +
                rows.map(campaignRow).join('') + '</table>'
              : '<p class="muted">No campaigns yet. The first one is ' +
                'probably the summer-project post.</p>') +
          '</div>';

        document.getElementById('newCampaign').onclick = function () {
          showCampaignForm(null);
        };
        wireCampaignButtons(view, rows);
      }).catch(function (e) { fail(view, e); });
    },

    /* Link clicks and app-wide activity, drawn. Everything on this screen
     * is app-wide — there is no team or player dimension in the payload,
     * by ADR-0020 Decision 5, so there is nothing here to filter down to
     * an individual child even if someone wanted to. */
    graphs: function (view, daysArg) {
      var days = Number(daysArg) > 0 ? Number(daysArg) : 30;
      api.get('/api/v1/admin/analytics?days=' + days).then(function (data) {
        var site = data.siteVisits || {
          totalViews: 0, averageDwellSeconds: null, dwellSamples: 0,
          perLocale: [], viewsPerDay: []
        };
        var activeToday = data.activePerDay.length
          ? data.activePerDay[data.activePerDay.length - 1].value : 0;
        var activePeak = data.activePerDay.reduce(function (max, p) {
          return Math.max(max, p.value);
        }, 0);

        view.innerHTML =
          '<h2>Graphs</h2>' +
          '<div class="card">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              [7, 30, 90].map(function (option) {
                return '<button data-go="graphs/' + option + '"' +
                  (option === days ? ' class="primary"' : '') + '>Last ' +
                  option + ' days</button>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 2px;font-size:15px">Players</h3>' +
            '<p class="muted" style="margin:0 0 14px"><strong>' +
              esc(data.totalPlayers) + '</strong> accounts in total · <strong>' +
              esc(activeToday) + '</strong> active today · busiest day <strong>' +
              esc(activePeak) + '</strong></p>' +
            '<p style="margin:0 0 4px;font-size:13px"><strong>Active players per day</strong> ' +
              '<span class="muted">— logged at least one session</span></p>' +
            lineChart(data.activePerDay, 'Active players per day') +
          '</div>' +

          '<div class="card">' +
            '<p style="margin:0 0 4px;font-size:13px"><strong>New accounts per day</strong></p>' +
            lineChart(data.signupsPerDay, 'New player accounts per day') +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 2px;font-size:15px">Link clicks</h3>' +
            '<p class="muted" style="margin:0 0 14px"><strong>' +
              esc(data.totalClicks) + '</strong> clicks over ' + esc(days) +
              ' days on the public site.</p>' +
            barChart(data.linkClicks.map(function (series) {
              return {
                label: LINK_LABEL[series.link] || series.link,
                value: series.total
              };
            }), 'Clicks per link') +
            (data.linkClicks.length
              ? '<p style="margin:18px 0 4px;font-size:13px"><strong>' +
                esc(LINK_LABEL[data.linkClicks[0].link] || data.linkClicks[0].link) +
                '</strong> <span class="muted">— the most clicked, per day</span></p>' +
                lineChart(data.linkClicks[0].daily, 'Clicks per day for the most clicked link')
              : '') +
          '</div>' +

          '<div class="card">' +
            '<h3 style="margin:0 0 2px;font-size:15px">Website reads</h3>' +
            '<p class="muted" style="margin:0 0 14px"><strong>' +
              esc(site.totalViews) + '</strong> page views over ' + esc(days) +
              ' days · typical read <strong>' + esc(dwellLabel(site.averageDwellSeconds)) +
              '</strong>' +
              (site.dwellSamples
                ? ' <span class="muted">(from ' + esc(site.dwellSamples) +
                  ' reads that reported a time)</span>'
                : '') +
            '</p>' +
            '<p style="margin:0 0 4px;font-size:13px"><strong>Page views per day</strong> ' +
              '<span class="muted">— both languages</span></p>' +
            lineChart(site.viewsPerDay, 'Website page views per day') +
          '</div>' +

          '<div class="card">' +
            '<p style="margin:0 0 4px;font-size:13px"><strong>Language</strong> ' +
              '<span class="muted">— which version of the site was read</span></p>' +
            barChart(site.perLocale.map(function (l) {
              return { label: SITE_LOCALE_LABEL[l.locale] || l.locale, value: l.views };
            }), 'Page views per language') +
            '<table style="margin-top:14px"><thead><tr>' +
              '<th>Language</th><th>Views</th><th>Share</th><th>Typical read</th>' +
            '</tr></thead><tbody>' +
            site.perLocale.map(function (l) {
              var share = site.totalViews
                ? Math.round((l.views / site.totalViews) * 100) : 0;
              return '<tr><td>' + esc(SITE_LOCALE_LABEL[l.locale] || l.locale) +
                '</td><td>' + esc(l.views) +
                '</td><td>' + esc(share) + '%' +
                '</td><td>' + esc(dwellLabel(l.averageDwellSeconds)) + '</td></tr>';
            }).join('') +
            '</tbody></table>' +
          '</div>' +

          '<p class="muted">Counts only. No cookies, no third-party ' +
          'analytics, and nothing identifying a visitor — a click is a ' +
          'number against a link and a date, so these charts cannot be ' +
          'narrowed to a person or a team.</p>' +
          '<p class="muted"><strong>Website reads are views, not people.</strong> ' +
          'One reader opening the page three times is three views. Telling ' +
          'them apart needs a per-visitor id, which this site deliberately ' +
          'does not set — and on a site children reach that id would also ' +
          'require a cookie banner. The typical read is averaged over the ' +
          'visits whose browser managed to report a duration, which is ' +
          'fewer than the views: a tab closed abruptly reports nothing.</p>';
      }).catch(function (e) { fail(view, e); });
    },

    /* Demo-event signups, and the send list built from them.
     *
     * The filter is the point, not decoration: the first round of invites
     * is mailed by hand from the exported CSV, so what an admin needs is
     * "who have I not contacted yet", not "everyone who ever signed up".
     * The CSV follows whatever is on screen, so exporting the send list
     * and mailing exactly that set is one action. */
    signups: function (view, filterArg) {
      var filter = SIGNUP_FILTERS[filterArg] ? filterArg : 'todo';
      api.get('/api/v1/admin/event-registrations').then(function (all) {
        var rows = all.filter(SIGNUP_FILTERS[filter].match);
        var pending = all.filter(SIGNUP_FILTERS.todo.match).length;

        view.innerHTML =
          '<h2>Demo signups</h2>' +
          '<div class="card">' +
            '<p style="margin:0 0 4px"><strong>' + esc(all.length) +
            '</strong> registered · <strong>' + esc(pending) +
            '</strong> still to invite · <strong>' +
            esc(all.filter(SIGNUP_FILTERS.releases.match).length) +
            '</strong> want release news</p>' +
            '<p class="muted" style="margin:0 0 12px">' +
            esc(interestSummary(all)) + '</p>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              Object.keys(SIGNUP_FILTERS).map(function (key) {
                return '<button data-go="signups/' + key + '"' +
                  (key === filter ? ' class="primary"' : '') + '>' +
                  esc(SIGNUP_FILTERS[key].label) + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="card">' +
            '<p style="margin:0 0 12px">' +
              '<button id="exportCsv"' + (rows.length ? '' : ' disabled') +
              '>Download CSV (' + esc(rows.length) + ')</button> ' +
              (filter === 'todo' && rows.length
                ? '<button id="markInvited">Mark these ' + esc(rows.length) +
                  ' as invited</button> ' +
                  '<button id="showSend" class="primary">Send invites by ' +
                  'email…</button>'
                : '') +
            '</p>' +
            /* Hidden until asked for: this button mails real people, and a
             * form sitting permanently open next to a list of addresses is
             * an easy thing to submit by accident. */
            '<div id="sendForm" class="card stub" style="display:none">' +
              '<h3 style="margin:0 0 4px;font-size:15px">Send the invitation</h3>' +
              '<p class="muted" style="margin:0 0 12px">Goes to the ' +
              esc(rows.length) + ' people listed below, one message each, ' +
              'every one carrying its own unsubscribe link. Anyone already ' +
              'invited is skipped.</p>' +
              '<div style="display:grid;gap:10px;max-width:420px">' +
                '<label>Google Meet link<input id="sendMeet" type="url" ' +
                'placeholder="https://meet.google.com/abc-defg-hij" ' +
                'style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit"></label>' +
                '<label>Starts (your local time)<input id="sendStart" ' +
                'type="datetime-local" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit"></label>' +
                '<label>Length in minutes<input id="sendMinutes" type="number" ' +
                'value="30" min="5" max="480" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit"></label>' +
                '<label>Anything to add? (optional)<textarea id="sendMessage" ' +
                'rows="3" maxlength="1000" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;font:inherit"></textarea></label>' +
                '<div><button id="sendGo" class="primary">Send to ' +
                esc(rows.length) + ' people</button></div>' +
                '<p id="sendMsg" class="muted" style="margin:0"></p>' +
              '</div>' +
            '</div>' +
            '<p id="signupMsg" class="muted" style="margin:0 0 12px"></p>' +
            '<table><tr><th>When</th><th>Name</th><th>Email</th>' +
            '<th>Interest</th><th>Lang</th><th>Campaign</th>' +
            '<th>Releases</th><th>Invited</th><th></th></tr>' +
            (rows.length ? rows.map(function (row) {
              return '<tr><td>' + esc(row.createdAt.slice(0, 10)) + '</td><td>' +
                esc(row.name) + '</td><td>' + esc(row.email) + '</td><td>' +
                esc(INTEREST_LABEL[row.interest] || row.interest) + '</td><td>' +
                esc(row.locale) + '</td><td>' + esc(row.campaign || '—') +
                '</td><td>' + (row.releaseUpdatesOptedInAt
                  ? esc(row.releaseUpdatesOptedInAt.slice(0, 10))
                  : '<span class="muted">no</span>') +
                '</td><td>' + (row.inviteSentAt
                  ? esc(row.inviteSentAt.slice(0, 10))
                  : '<span class="muted">not yet</span>') +
                '</td><td style="text-align:right"><button data-remove="' +
                esc(row.id) + '">Remove</button></td></tr>';
            }).join('')
              : '<tr><td colspan="9" class="muted">Nothing here.</td></tr>') +
            '</table></div>' +
          (filter === 'releases'
            ? '<div class="card"><h3 style="margin:0 0 4px;font-size:15px">' +
              'Ask the rest of the list</h3>' +
              '<p class="muted" style="margin:0 0 12px">Everyone who signed ' +
              'up before the release-news box existed agreed to a demo ' +
              'invitation and nothing else, so they cannot be mailed about ' +
              'releases until they say yes. This asks them once, under the ' +
              'consent they already gave, and adds nobody — only the button ' +
              'in their own inbox does that. Anyone already asked is ' +
              'skipped, so pressing it twice is safe.</p>' +
              '<button id="askReleases">Send the question</button> ' +
              '<span id="askMsg" class="muted"></span></div>'
            : '') +
          '<p class="muted">The CSV carries a personal unsubscribe link per ' +
          'row — put it in whatever you send, including a mail merge. ' +
          'Held on consent, so &ldquo;remove&rdquo; deletes the row outright. ' +
          'Nothing on this page is connected to any player or team.</p>';

        var exportButton = document.getElementById('exportCsv');
        if (exportButton) {
          exportButton.onclick = function () { downloadCsv(rows, filter); };
        }

        var askButton = document.getElementById('askReleases');
        if (askButton) {
          askButton.onclick = function () {
            var askMsg = document.getElementById('askMsg');
            askButton.disabled = true;
            askMsg.className = 'muted';
            askMsg.textContent = 'Sending…';
            api.post('/api/v1/admin/event-registrations/ask-release-consent',
                     {})
              .then(function (result) {
                askMsg.textContent = 'Asked ' + result.sent + '. ' +
                  (result.failed
                    ? result.failed + ' failed — they stay unasked and the ' +
                      'next run picks them up.'
                    : 'Nobody is on the release list until they answer.');
              })
              .catch(function (e) {
                askButton.disabled = false;
                askMsg.className = 'err';
                askMsg.textContent = errorMessage(e);
              });
          };
        }

        var markButton = document.getElementById('markInvited');
        if (markButton) {
          markButton.onclick = function () {
            var msg = document.getElementById('signupMsg');
            markButton.disabled = true;
            msg.textContent = 'Marking…';
            /* Marks exactly the ids on screen, never "everything unsent":
             * somebody registering between the export and the mailing was
             * not actually invited, and sweeping them into "contacted"
             * would mean they never hear from us at all. */
            api.post('/api/v1/admin/event-registrations/mark-invited', {
              ids: rows.map(function (row) { return row.id; })
            }).then(function () { go('signups/todo'); })
              .catch(function (e) {
                markButton.disabled = false;
                msg.className = 'err';
                msg.textContent = errorMessage(e);
              });
          };
        }

        var showSend = document.getElementById('showSend');
        if (showSend) {
          showSend.onclick = function () {
            document.getElementById('sendForm').style.display = '';
            showSend.disabled = true;
          };
        }

        var sendGo = document.getElementById('sendGo');
        if (sendGo) {
          sendGo.onclick = function () {
            var msg = document.getElementById('sendMsg');
            var meet = document.getElementById('sendMeet').value.trim();
            var startLocal = document.getElementById('sendStart').value;
            if (!meet || !startLocal) {
              msg.className = 'err';
              msg.textContent = 'A Meet link and a start time are both needed.';
              return;
            }
            sendGo.disabled = true;
            msg.className = 'muted';
            msg.textContent = 'Sending — one message at a time, so this takes a moment…';
            api.post('/api/v1/admin/event-registrations/send-invites', {
              meetUrl: meet,
              // datetime-local has no timezone; new Date() reads it as
              // local time and toISOString converts, which is what the
              // server expects.
              startsAt: new Date(startLocal).toISOString(),
              durationMinutes: Number(document.getElementById('sendMinutes').value) || 30,
              message: document.getElementById('sendMessage').value.trim() || undefined
            }).then(function (result) {
              msg.className = result.failed ? 'err' : 'muted';
              msg.textContent = 'Sent ' + result.sent + ', failed ' +
                result.failed + ', skipped ' + result.skipped +
                (result.failed
                  ? '. The failures kept their unsent state and will be retried next time.'
                  : '.');
              setTimeout(function () { go('signups/todo'); }, 2500);
            }).catch(function (e) {
              sendGo.disabled = false;
              msg.className = 'err';
              msg.textContent = errorMessage(e);
            });
          };
        }

        Array.prototype.forEach.call(
          view.querySelectorAll('[data-remove]'),
          function (button) {
            button.onclick = function () {
              button.disabled = true;
              button.textContent = 'Removing…';
              api.del('/api/v1/admin/event-registrations/' +
                      encodeURIComponent(button.getAttribute('data-remove')))
                .then(function () { go('signups/' + filter); })
                .catch(function (e) {
                  button.disabled = false;
                  button.textContent = 'Remove';
                  alertInline(button, errorMessage(e));
                });
            };
          }
        );
      }).catch(function (e) { fail(view, e); });
    },

    errors: function (view) {
      api.get('/api/v1/admin/errors').then(function (r) {
        var rows = (r.entries || r.rows || []).slice(0, 50).map(function (x) {
          /* A client row carries no status and no route, so the Source cell
           * is where its two identifying facts go. Without the build, a
           * crash report is close to unactionable: "only on Android" and
           * "only since build 14" are the first two questions anyone asks,
           * and they are the only two this table is willing to answer. */
          var source = esc(x.source);
          if (x.source === 'client') {
            source += ' <span class="muted">' +
              esc([x.clientPlatform, x.clientAppVersion]
                    .filter(Boolean).join(' ')) + '</span>';
          }
          return '<tr><td>' + esc(x.occurredAt) + '</td><td>' + source +
                 '</td><td>' + esc(x.statusCode || '') + '</td><td>' +
                 esc(ERROR_NAME_LABEL[x.errorName] || x.errorName || '') +
                 '</td><td>' + esc(x.message) + '</td></tr>';
        }).join('');
        view.innerHTML = '<h2>Errors</h2><div class="card"><table>' +
          '<tr><th>When</th><th>Source</th><th>Status</th><th>Why</th><th>Message</th></tr>' +
          (rows || '<tr><td colspan="5" class="muted">Nothing logged.</td></tr>') +
          '</table></div>' +
          '<p class="muted"><strong>client</strong> rows are crashes inside ' +
          'the phone app, reported by the device. They carry the platform ' +
          'and the build and nothing else &mdash; there is no player or ' +
          'team column on this table to carry more.</p>' +
          '<p class="muted">Every 401 answers the caller with the same ' +
          'generic message on purpose — telling someone &ldquo;expired&rdquo; ' +
          'rather than &ldquo;invalid&rdquo; would confirm their token was ' +
          'correctly signed. The <strong>Why</strong> column is where the ' +
          'difference is kept.</p>';
      }).catch(function (e) { fail(view, e); });
    },

    /* Bug reports, with triage. The list existed; changing a status meant
     * a psql prompt, which is the exact thing ADR-0022 built this console
     * to replace.
     *
     * Transitions are unrestricted (open <-> triaged <-> closed) because
     * Decision 7 argued that deliberately: there is one operator and no
     * audit trail, and a mis-clicked "Closed" that cannot be undone from
     * the UI sends that operator straight back to psql. */
    bugs: function (view, filterArg) {
      var status = BUG_STATUSES.indexOf(filterArg) >= 0 ? filterArg : '';
      api.get('/api/v1/admin/bug-reports' +
              (status ? '?status=' + encodeURIComponent(status) : ''))
        .then(function (r) {
          var rows = r.reports || [];
          var counts = r.countsByStatus || r.counts || {};

          view.innerHTML =
            '<h2>Bug reports</h2>' +
            '<div class="card">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button data-go="bugs"' + (status ? '' : ' class="primary"') +
                '>All' + countSuffix(counts) + '</button>' +
                BUG_STATUSES.map(function (st) {
                  return '<button data-go="bugs/' + st + '"' +
                    (st === status ? ' class="primary"' : '') + '>' +
                    esc(BUG_STATUS_LABEL[st]) +
                    (typeof counts[st] === 'number' ? ' (' + esc(counts[st]) + ')' : '') +
                    '</button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<div class="card">' +
              (rows.length
                ? '<table><tr><th>When</th><th>Reporter</th><th>Where</th>' +
                  '<th>What</th><th>Build</th><th>Status</th><th></th></tr>' +
                  rows.map(bugRow).join('') + '</table>'
                : '<p class="muted">Nothing here. An empty queue and a ' +
                  'broken reporting flow look identical, so it is worth ' +
                  'filing one from the app occasionally to be sure.</p>') +
            '</div>';

          wireBugButtons(view, status);
        }).catch(function (e) { fail(view, e); });
    },

    planning: function (view) {
      api.get('/api/v1/admin/planning/roadmap').then(function (r) {
        var body = (r.sections || []).map(function (s) {
          return s.available
            ? '<div class="card"><h3>' + esc(s.source) + '</h3><pre style="white-space:pre-wrap;font:inherit">' +
              esc(s.content) + '</pre></div>'
            : '<div class="card stub"><h3>' + esc(s.source) + '</h3><p class="muted">Not mounted on this cluster.</p></div>';
        }).join('');
        view.innerHTML = '<h2>Planning</h2>' + body;
      }).catch(function (e) {
        if (e && e.error && e.error.code === 'reauth_required') {
          view.innerHTML = '<h2>Planning</h2><div class="card">' +
            '<p>This section needs you to confirm it is you.</p>' +
            '<p class="muted">Your session stays signed in — this is an ' +
            'extra check for the planning documents only. You will come ' +
            'back to this tab.</p>' +
            '<button id="stepUp" class="primary">Confirm it is me</button></div>';
          /* Remember where to return. The step-up round trip ends at the
           * callback, which redirects to a FIXED /console/ path — that is
           * deliberate (a ?next= there would be an open redirect on the one
           * endpoint that just minted a session), so the return tab is
           * remembered on this side instead. Without it the copy above
           * promised something the flow did not do. */
          document.getElementById('stepUp').onclick = function () {
            try { sessionStorage.setItem('skillstreak.returnTo', 'planning'); }
            catch (err) { /* private mode — you just land on the default tab */ }
            window.location.href = '/api/v1/staff-auth/google/step-up';
          };
          return;
        }
        fail(view, e);
      });
    },


    /* The clip-tagging panel (Open Question 5, decided 2026-08-12).
     *
     * Built INSTEAD of a fixture-set evaluation, and the reasoning is
     * worth keeping next to the code: the pipeline already tags real
     * clips for free, so its own output is continuous evidence about
     * whether this model works on this project's actual footage — at no
     * cost and with nobody filming anything. A fixture set is more
     * rigorous and is still how a threshold gets set; it just measures
     * something no code currently reads.
     *
     * Aggregate only. No team, no player, no clip, and no filter that
     * could become one. */
    tagging: function (view) {
      api.get('/api/v1/admin/clip-tagging/stats').then(function (s) {
        var processed = (s.statusCounts.tagged || 0) +
                        (s.statusCounts.no_confident_tags || 0);

        function pct(n) { return Math.round(n * 100) + '%'; }

        view.innerHTML =
          '<h2>Clip tagging</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">How the automatic ' +
            'training-type tagger is doing, across every published clip. ' +
            'Counts only — this page cannot show which clip, which team or ' +
            'which player, and has no filter that could.</p>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
              tile(s.publishedClips, 'Published clips') +
              tile(processed, 'Looked at') +
              tile(s.pending, 'Waiting') +
              tile(s.failed, 'Gave up') +
            '</div>' +
          '</div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 4px;font-size:15px">Declined to tag' +
              info('Of the clips the model actually looked at, how often ' +
                   'it found nothing it was confident about. This is the ' +
                   'number that says whether the model understands this ' +
                   'kind of footage at all. High is not a bug — saying ' +
                   'nothing is always safer than a wrong guess about a ' +
                   'child\'s video.') +
            '</h3>' +
            (s.silentRate === null
              ? '<p class="muted" style="margin:0">Nothing processed yet. ' +
                'This stays blank rather than showing 0%, because ' +
                '"nothing has run" and "it tags everything" are opposite ' +
                'findings.</p>'
              : '<p style="font-size:26px;font-weight:680;margin:0">' +
                esc(pct(s.silentRate)) + '</p>' +
                '<p class="muted" style="margin:4px 0 0">' +
                esc((s.statusCounts.no_confident_tags || 0) + ' of ' +
                    processed + ' clips') + '</p>') +
          '</div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 8px;font-size:15px">What it found</h3>' +
            (s.tagCounts.length
              ? '<table><thead><tr><th>Tag</th><th>Clips</th>' +
                '<th>Avg confidence</th></tr></thead><tbody>' +
                s.tagCounts.map(function (row) {
                  return '<tr><td>' + esc(row.tag) + '</td><td>' +
                    esc(row.count) + '</td><td>' +
                    esc(row.averageConfidence) + '</td></tr>';
                }).join('') + '</tbody></table>'
              : '<p class="muted" style="margin:0">No tags stored yet.</p>') +
          '</div>' +
          '<div id="planHealth"></div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 8px;font-size:15px">Produced by' +
              info('Every stored tag records the model and the prompt ' +
                   'wording that produced it. A prompt edit changes ' +
                   'scores as surely as a model swap, so both are kept — ' +
                   'without them a row could not be traced to what made ' +
                   'it.') +
            '</h3>' +
            (s.sources.length
              ? s.sources.map(function (row) {
                  return '<p class="muted" style="margin:0 0 4px">' +
                    esc(row.source) + ' — ' + esc(row.count) + '</p>';
                }).join('')
              : '<p class="muted" style="margin:0">Nothing yet.</p>') +
          '</div>';

        /* Plan generation lives in the same panel rather than a fourth AI
         * tab: an operator asking "is the AI working" means both, and a
         * tab nobody opens is not visibility. Fetched separately so a
         * failure here cannot blank the tagging numbers. */
        api.get('/api/v1/admin/training-plans/stats').then(function (p) {
          var stale = p.oldestQueuedSeconds !== null &&
                      p.oldestQueuedSeconds > 600;
          document.getElementById('planHealth').innerHTML =
            '<div class="card">' +
              '<h3 style="margin:0 0 8px;font-size:15px">Session planner' +
                info('The generator has no HTTP endpoint by design, so ' +
                     'nothing probes it. A queue that stops draining is ' +
                     'the signal that it has gone away — that is what ' +
                     '"oldest waiting" is for.') +
              '</h3>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
                tile(p.totalPlans, 'Sessions written') +
                tile(p.queued, 'Waiting') +
                tile(p.failed, 'Failed') +
              '</div>' +
              (p.oldestQueuedSeconds === null
                ? '<p class="muted" style="margin:0">Queue empty.</p>'
                : '<p class="' + (stale ? 'err' : 'muted') + '" style="margin:0">' +
                  'Oldest waiting: ' + esc(Math.round(p.oldestQueuedSeconds / 60)) +
                  ' min' + (stale ? ' — the generator may be down.' : '') +
                  '</p>') +
              (p.models.length
                ? p.models.map(function (m) {
                    return '<p class="muted" style="margin:6px 0 0">' +
                      esc(m.modelId) + ' — ' + esc(m.count) + '</p>';
                  }).join('')
                : '') +
            '</div>';
        }).catch(function () {
          document.getElementById('planHealth').innerHTML =
            '<div class="card"><p class="muted">Session planner stats ' +
            'unavailable.</p></div>';
        });
      }).catch(function (e) { fail(view, e); });
    },


    /* The session planner (ADR-0028 Phase 1).
     *
     * Asynchronous by necessity, not by preference: the GPU cluster has
     * no inbound route, so a request is a job the generator leases. That
     * shows up here as "Generating…" and a poll — and the copy says how
     * long it takes, because a spinner with no estimate reads as broken
     * after about ten seconds.
     *
     * Nothing on this page is child-facing and nothing accepts a player.
     * ADR-0028 Decision 5: the consumer is a staff account, and there is
     * no child-facing prompt box anywhere in this app. */
    plans: function (view) {
      api.get('/api/v1/training-plans').then(function (plans) {
        view.innerHTML =
          '<h2>Session planner</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">Describe the session ' +
            'you want and it is written from the drill library. It takes ' +
            'about a minute. Read it before you use it — it is a draft, ' +
            'not a coach.</p>' +
            '<label for="planPrompt">What kind of session?</label>' +
            '<p class="muted" style="margin:0 0 6px">Describe the ' +
            'session, not the players — do not write anyone\'s name ' +
            'here.</p>' +
            '<input id="planPrompt" maxlength="1000" autocomplete="off" ' +
              'placeholder="kul pass med mycket rörelse">' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' +
              '<span><label for="planAge">Age group</label>' +
              '<select id="planAge">' +
                DRILL_AGE_BANDS.map(function (b) {
                  return '<option value="' + esc(b) + '">' +
                    esc(ageBandLabel(b)) + '</option>';
                }).join('') +
              '</select></span>' +
              '<span><label for="planMinutes">Minutes</label>' +
              '<select id="planMinutes">' +
                [15, 30, 45, 60, 90].map(function (m) {
                  return '<option value="' + m + '"' +
                    (m === 45 ? ' selected' : '') + '>' + m + '</option>';
                }).join('') +
              '</select></span>' +
              '<span><label for="planFocus">Focus</label>' +
              '<select id="planFocus"><option value="">—</option>' +
                DRILL_FOCUSES.map(function (f) {
                  return '<option value="' + esc(f) + '">' +
                    esc(focusLabel(f)) + '</option>';
                }).join('') +
              '</select></span>' +
            '</div>' +
            '<p style="margin-top:12px"><button id="planGo" class="primary">' +
              'Write the session</button></p>' +
            '<p id="planMsg" class="muted"></p>' +
          '</div>' +
          '<div id="planList">' + planRows(plans) + '</div>';

        document.getElementById('planGo').onclick = function () {
          var msg = document.getElementById('planMsg');
          var body = {
            promptText: document.getElementById('planPrompt').value.trim(),
            ageBand: document.getElementById('planAge').value,
            durationMinutes: Number(document.getElementById('planMinutes').value),
            focus: document.getElementById('planFocus').value || undefined,
            locale: effectiveLang()
          };
          if (body.promptText.length < 3) {
            msg.className = 'err';
            msg.textContent = 'Describe the session in a few words first.';
            return;
          }
          msg.className = 'muted';
          msg.textContent = 'Sending…';
          api.post('/api/v1/training-plans', body).then(function () {
            go('plans');
          }).catch(function (err) {
            msg.className = 'err';
            msg.textContent = errorMessage(err);
          });
        };

        /* Deleting matters more here than it looks: a coach who typed a
         * player's name into a prompt has no other way to remove it —
         * this table has no player id, so an account erasure cannot find
         * it either (ADR-0028 Decision 7(c)). Two clicks rather than a
         * confirm() dialog, same as everywhere else in this console. */
        Array.prototype.forEach.call(
          view.querySelectorAll('[data-drop-plan]'),
          function (button) {
            button.onclick = function () {
              if (!button.getAttribute('data-armed')) {
                button.setAttribute('data-armed', '1');
                button.textContent = 'Tap again to delete';
                return;
              }
              api.del('/api/v1/training-plans/' +
                encodeURIComponent(button.getAttribute('data-drop-plan')))
                .then(function () { go('plans'); })
                .catch(function (err) {
                  var msg = document.getElementById('planMsg');
                  msg.className = 'err';
                  msg.textContent = errorMessage(err);
                });
            };
          }
        );

        /* Poll only while something is actually being generated, and stop
         * when the view changes — an interval left running after
         * navigation would keep hitting the API from a page nobody is
         * looking at. */
        if (plans.some(function (p) {
          return p.status === 'queued' || p.status === 'generating';
        })) {
          schedulePlanRefresh();
        }
      }).catch(function (e) { fail(view, e); });
    },

    /* One session. The body is Markdown a model wrote, rendered as
     * escaped plain text in a <pre> — same choice as the drill detail
     * view, and more important here: this text is machine-generated, so
     * parsing it into HTML would let a model's output become markup. */
    plan: function (view, id) {
      api.get('/api/v1/training-plans/' + encodeURIComponent(id)).then(function (p) {
        view.innerHTML =
          backLink('plans', 'Session planner') +
          '<h2>' + esc(p.promptText) + '</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">' +
              esc(ageBandLabel(p.ageBand)) + ' · ' +
              esc(p.durationMinutes) + ' min' +
              (p.focus ? ' · ' + esc(focusLabel(p.focus)) : '') +
            '</p>' +
            (p.status === 'ready'
              ? '<pre style="white-space:pre-wrap;font:inherit;margin:0">' +
                esc(p.generatedPlan) + '</pre>'
              : '<p class="muted" style="margin:0">' +
                esc(planStatusLabel(p)) + '</p>') +
          '</div>' +
          (p.status === 'ready'
            ? '<div class="card"><p class="muted" style="margin:0">' +
              'Written by ' + esc(p.modelId || '—') + ' from ' +
              esc(String(p.corpusVersion || '').split(':')[0] || '0') +
              ' drills. A draft — read it before you use it.</p></div>'
            : '') +
          (p.status === 'ready' ? submitAsPostCard(p) : '');

        if (p.status === 'ready') wireSubmitAsPost(p);
      }).catch(function (e) { fail(view, e); });
    },


    /* ---- trainer tips -------------------------------------------------
     *
     * The authoring side. A trainer writes a tip; it goes nowhere until
     * an operator reads it. The copy has to carry that, because the gap
     * between "I posted" and "children can see it" is the whole control
     * and a silent queue reads as a broken button.
     *
     * The content rule is stated up front rather than only enforced on
     * submit: being told after writing four paragraphs that links are not
     * allowed is a worse experience than being told before. */
    /**
     * A tip as a player's Tips screen shows it.
     *
     * Reads `previewPost`, which the buttons below set — deliberately no
     * fetch and no id in the route. Everything shown here is already on
     * the page, and that keeps the preview usable for a tip that does not
     * exist yet: the compose form previews what is typed, before anything
     * is sent for review, which is the case worth having.
     *
     * It renders HTML while the app renders React Native, so it is a
     * close approximation and says so on screen rather than implying a
     * fidelity it cannot have. What it does reproduce exactly is the part
     * that matters for a review decision: the same three fields, the same
     * order, the same copy around them, and body text escaped and never
     * parsed as markup — matching TipsScreen's own deliberate choice,
     * since this is text about to be put in front of children.
     */
    playerPreview: function (view) {
      if (!previewPost) {
        view.innerHTML =
          '<h2>Preview</h2><div class="card"><p class="muted">' +
          'Nothing to preview. Open a tip and choose “Preview as player”.' +
          '</p><p><button data-go="posts">Back to my tips</button></p></div>';
        return;
      }
      var post = previewPost;
      view.innerHTML =
        '<h2>Preview</h2>' +
        '<div class="card"><p class="muted" style="margin:0">' +
          'This is roughly what a player sees in the app’s Tips ' +
          'screen. Close, not pixel-perfect — the app draws this ' +
          'natively, not as a web page.' +
        '</p></div>' +
        '<div class="phone"><div class="phone-screen">' +
          '<p class="tips-head">Tips</p>' +
          '<p class="tips-intro">Tips från tränare. Alla läses ' +
            'av en administratör innan de hamnar här.</p>' +
          '<div class="tip-card">' +
            '<p class="tip-title">' + esc(post.title || '(no title yet)') + '</p>' +
            '<p class="tip-byline">' + esc(post.authorByline || '(no byline yet)') + '</p>' +
            '<p class="tip-body">' + esc(post.body || '') + '</p>' +
          '</div>' +
          '<p class="tips-end">Det var alla tips just nu.</p>' +
        '</div></div>' +
        '<p><button data-go="posts">Back to my tips</button></p>';
    },

    posts: function (view) {
      api.get('/api/v1/trainer-posts/mine').then(function (posts) {
        view.innerHTML =
          '<h2>My tips</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">Write something ' +
            'useful for players and coaches. An admin reads every tip ' +
            'before anyone sees it.</p>' +
            '<p class="muted" style="margin:0 0 12px">You can say who you ' +
            'are and where you coach. You cannot include links, email ' +
            'addresses or phone numbers.</p>' +
            '<label for="postTitle">Title</label>' +
            '<input id="postTitle" maxlength="120" autocomplete="off" ' +
              'placeholder="Tre sätt att träna passningar hemma">' +
            '<label for="postByline">How readers see you</label>' +
            '<input id="postByline" maxlength="80" autocomplete="off" ' +
              'placeholder="Anna, tränare i Uppsala">' +
            '<label for="postBody">The tip</label>' +
            '<textarea id="postBody" rows="7" maxlength="4000"></textarea>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">' +
              '<span><label for="postAge">Age group</label>' +
              '<select id="postAge"><option value="">—</option>' +
                DRILL_AGE_BANDS.map(function (b) {
                  return '<option value="' + esc(b) + '">' +
                    esc(ageBandLabel(b)) + '</option>';
                }).join('') + '</select></span>' +
              '<span><label for="postFocus">Focus</label>' +
              '<select id="postFocus"><option value="">—</option>' +
                DRILL_FOCUSES.map(function (f) {
                  return '<option value="' + esc(f) + '">' +
                    esc(focusLabel(f)) + '</option>';
                }).join('') + '</select></span>' +
            '</div>' +
            '<p style="margin-top:12px"><button id="postGo" class="primary">' +
              'Send for review</button> ' +
              '<button id="postPreview">Preview as player</button></p>' +
            '<p id="postMsg" class="muted"></p>' +
          '</div>' +
          (posts.length
            ? posts.map(ownPostCard).join('')
            : '<div class="card"><p class="muted">No tips yet.</p></div>');

        document.getElementById('postGo').onclick = function () {
          var msg = document.getElementById('postMsg');
          var body = {
            title: document.getElementById('postTitle').value.trim(),
            authorByline: document.getElementById('postByline').value.trim(),
            body: document.getElementById('postBody').value.trim(),
            ageBand: document.getElementById('postAge').value || undefined,
            focus: document.getElementById('postFocus').value || undefined,
            locale: effectiveLang()
          };
          if (body.title.length < 4 || body.body.length < 20 ||
              body.authorByline.length < 2) {
            msg.className = 'err';
            msg.textContent = 'A title, a byline and a few sentences, please.';
            return;
          }
          msg.className = 'muted';
          msg.textContent = 'Sending…';
          api.post('/api/v1/trainer-posts', body)
            .then(function () { go('posts'); })
            .catch(function (err) {
              /* The server names the offending field for this one, and
               * that message is the useful part — it is the rare
               * rejection the author can actually fix. */
              msg.className = 'err';
              msg.textContent = errorMessage(err);
            });
        };

        wirePostDeletes(view, 'posts');
        wirePostPreviews(view, posts);

        // Previews the unsaved draft, which is the point: a tip can be
        // checked against a child's screen before it is sent for review,
        // rather than after someone else has already had to read it.
        document.getElementById('postPreview').onclick = function () {
          preview({
            title: document.getElementById('postTitle').value.trim(),
            authorByline: document.getElementById('postByline').value.trim(),
            body: document.getElementById('postBody').value.trim(),
          });
        };
      }).catch(function (e) { fail(view, e); });
    },

    /* ---- tip review ---------------------------------------------------
     *
     * The control the whole feature rests on: nothing a trainer writes
     * reaches a child until someone here reads it and says yes.
     *
     * Published posts are listed alongside the queue so a takedown has
     * something to act on — an unpublish endpoint whose argument cannot
     * be found from the UI is a control that exists and cannot be used. */
    postReview: function (view) {
      Promise.all([
        api.get('/api/v1/admin/trainer-posts/pending'),
        api.get('/api/v1/admin/trainer-posts/published')
      ]).then(function (results) {
        var pending = results[0];
        var live = results[1];

        view.innerHTML =
          '<h2>Tip review</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0">Every tip is read here ' +
            'before players can see it. There is no automatic check — ' +
            'you are it.</p>' +
            (pending.filter(function (p) { return p.machineDrafted; }).length
              ? '<p class="muted" style="margin:8px 0 0">' +
                pending.filter(function (p) { return p.machineDrafted; }).length +
                ' of ' + pending.length + ' waiting started as a machine ' +
                'draft. Each is marked below.</p>'
              : '') +
            '<p id="reviewMsg" class="muted" style="margin:8px 0 0"></p>' +
          '</div>' +
          '<h3 style="margin:20px 0 8px;font-size:16px">Waiting for review</h3>' +
          (pending.length
            ? pending.map(function (p) { return reviewCard(p, true); }).join('')
            : '<div class="card"><p class="muted">Nothing waiting.</p></div>') +
          '<h3 style="margin:24px 0 8px;font-size:16px">Live now</h3>' +
          (live.length
            ? live.map(function (p) { return reviewCard(p, false); }).join('')
            : '<div class="card"><p class="muted">Nothing published yet.</p></div>');

        wireReviewButtons(view);
        wirePostPreviews(view, pending.concat(live));
      }).catch(function (e) { fail(view, e); });
    },

    /* The coach drill library (ADR-0029 Mechanism 1).
     *
     * Adult-authored training material, and nothing else — no child's
     * clip, name, streak or words appears here or can be reached from
     * here. There is no drill table, so there is no row to join to a
     * player in the first place.
     *
     * Visible to a trainer holding an active team link, and to admins. */
    /* The drill library, with a search box and a length filter.
     *
     * Both filter IN THE BROWSER over the already-fetched list rather than
     * round-tripping. The library is tens of drills, not thousands, so a
     * request per keystroke would be latency for its own sake — and
     * filtering client-side means the name search stays instant while a
     * trainer types.
     *
     * The filter state lives in the route (`drills/<focus>/<length>`) so a
     * filtered view can be linked and survives a refresh, and the search
     * text lives in the input, so typing never re-renders the list out
     * from under the cursor. */
    drills: function (view, filterArg) {
      var parts = String(filterArg || '').split('~');
      var focus = DRILL_FOCUSES.indexOf(parts[0]) >= 0 ? parts[0] : '';
      var length = DRILL_LENGTHS[parts[1]] ? parts[1] : '';
      var groupId = parts[2] || '';

      Promise.all([
        api.get('/api/v1/drills' + (focus ? '?focus=' + encodeURIComponent(focus) : '')),
        api.get('/api/v1/drill-groups')
      ]).then(function (results) {
          var rows = results[0];
          var groups = results[1];

          /* A group filtered on, then deleted in another tab, would
           * otherwise silently show an empty library. Falling back to
           * "all" is the honest answer to "that shelf is gone". */
          var active = groups.filter(function (g) { return g.id === groupId; })[0];
          if (!active) groupId = '';

          function routeFor(nextFocus, nextLength, nextGroup) {
            var tail = [nextFocus || '', nextLength || '', nextGroup || ''].join('~');
            return 'drills' + (tail === '~~' ? '' : '/' + tail);
          }

          view.innerHTML =
            '<h2>Drill library</h2>' +
            '<div class="card">' +
              '<p class="muted" style="margin:0 0 12px">Coach-authored ' +
              'training material. It carries no clips, no training logs and ' +
              'no player data — drills are files in the repository, read by ' +
              'a person before they merge.</p>' +
              '<input id="drillSearch" type="search" placeholder="Search by name" ' +
              'style="margin-bottom:12px" autocomplete="off">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
                '<button data-go="' + esc(routeFor('', length, groupId)) + '"' +
                (focus ? '' : ' class="primary"') + '>All focuses</button>' +
                DRILL_FOCUSES.map(function (f) {
                  return '<button data-go="' + esc(routeFor(f, length, groupId)) + '"' +
                    (f === focus ? ' class="primary"' : '') + '>' +
                    esc(focusLabel(f)) + '</button>';
                }).join('') +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
                '<button data-go="' + esc(routeFor(focus, '', groupId)) + '"' +
                (length ? '' : ' class="primary"') + '>Any length</button>' +
                Object.keys(DRILL_LENGTHS).map(function (key) {
                  return '<button data-go="' + esc(routeFor(focus, key, groupId)) + '"' +
                    (key === length ? ' class="primary"' : '') + '>' +
                    esc(DRILL_LENGTHS[key].label) + '</button>';
                }).join('') +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                '<button data-go="' + esc(routeFor(focus, length, '')) + '"' +
                (groupId ? '' : ' class="primary"') + '>All groups</button>' +
                groups.map(function (group) {
                  return '<button data-go="' +
                    esc(routeFor(focus, length, group.id)) + '"' +
                    (group.id === groupId ? ' class="primary"' : '') + '>' +
                    esc(group.name) + '</button>';
                }).join('') +
                '<button class="link" data-go="drillGroups">' +
                  '<span>Manage groups</span></button>' +
              '</div>' +
            '</div>' +
            '<div id="drillResults"></div>';

          function paint() {
            var query = (document.getElementById('drillSearch').value || '')
              .trim().toLowerCase();
            /* Membership is resolved against the same library listing, so
             * a drill removed from the repo drops out of its groups here
             * exactly as it does server-side. */
            var inGroup = null;
            if (groupId) {
              inGroup = {};
              (groups.filter(function (g) { return g.id === groupId; })[0]
                .drills || []).forEach(function (drill) {
                  inGroup[drill.slug] = true;
                });
            }

            var shown = rows.filter(function (drill) {
              if (inGroup && !inGroup[drill.slug]) return false;
              if (length && !DRILL_LENGTHS[length].match(drill.durationMinutes)) {
                return false;
              }
              /* Title only, not the body: the body is not in the listing
               * payload, so searching it would silently match nothing. */
              return !query || drill.title.toLowerCase().indexOf(query) >= 0;
            });

            document.getElementById('drillResults').innerHTML = shown.length
              ? shown.map(drillCard).join('')
              : '<div class="card"><p class="muted">' +
                (rows.length
                  ? 'Nothing matches that.'
                  : 'Nothing here yet. Drills are added to the repository ' +
                    'and arrive with the next release.') +
                '</p></div>';
          }

          document.getElementById('drillSearch').oninput = paint;
          paint();
        }).catch(function (e) { fail(view, e); });
    },

    /* Managing the shelves themselves: create, rename, retag, delete.
     *
     * Deleting a group deletes only the group — the drills are files and
     * are untouched, which the copy says out loud so nobody hesitates over
     * a destructive-sounding button that isn't. */
    drillGroups: function (view) {
      api.get('/api/v1/drill-groups').then(function (groups) {
        view.innerHTML =
          backLink('drills', 'Drill library') +
          '<h2>Your drill groups</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">Your own shelves over ' +
            'the shared library. Only you can see them. Deleting a group ' +
            'never deletes a drill.</p>' +
            '<label for="groupName">Group name</label>' +
            '<input id="groupName" maxlength="80" autocomplete="off" ' +
              'placeholder="Warm-up">' +
            '<label for="groupTags">Tags, separated by commas</label>' +
            '<input id="groupTags" autocomplete="off" ' +
              'placeholder="indoors, short, u11">' +
            '<p><button id="groupSave" class="primary">Create group</button>' +
            '<button id="groupCancel" class="link" style="display:none">' +
              '<span>Cancel</span></button></p>' +
            '<p id="groupMsg" class="muted"></p>' +
          '</div>' +
          (groups.length
            ? groups.map(function (group) {
                return '<div class="card">' +
                  '<h3 style="margin:0 0 4px;font-size:15px">' +
                    esc(group.name) + '</h3>' +
                  '<p class="muted" style="margin:0 0 8px">' +
                    esc(drillCountLabel(group.drills.length)) + '</p>' +
                  tagChips(group.tags) +
                  '<button data-edit="' + esc(group.id) + '">Rename or retag</button> ' +
                  '<button data-drop="' + esc(group.id) + '">Delete group</button>' +
                  '</div>';
              }).join('')
            : '<div class="card"><p class="muted">No groups yet. Make one ' +
              'above, then add drills to it from any drill.</p></div>');

        var editing = null;
        var name = document.getElementById('groupName');
        var tags = document.getElementById('groupTags');
        var msg = document.getElementById('groupMsg');
        var cancel = document.getElementById('groupCancel');

        function reset() {
          editing = null;
          name.value = '';
          tags.value = '';
          msg.textContent = '';
          cancel.style.display = 'none';
          document.getElementById('groupSave').textContent = 'Create group';
        }

        cancel.onclick = reset;

        document.getElementById('groupSave').onclick = function () {
          var body = {
            name: name.value.trim(),
            /* Split here as well as server-side: a trainer typing one box
             * of comma-separated tags should see them as separate chips,
             * and the server normalises whatever arrives anyway. */
            tags: tags.value.split(',').map(function (tag) {
              return tag.trim();
            }).filter(Boolean)
          };
          if (!body.name) {
            msg.className = 'err';
            msg.textContent = 'A group needs a name.';
            return;
          }
          msg.className = 'muted';
          msg.textContent = 'Saving…';
          (editing
            ? api.put('/api/v1/drill-groups/' + encodeURIComponent(editing), body)
            : api.post('/api/v1/drill-groups', body)
          ).then(function () { go('drillGroups'); })
            .catch(function (err) {
              msg.className = 'err';
              msg.textContent = errorMessage(err);
            });
        };

        Array.prototype.forEach.call(
          view.querySelectorAll('[data-edit]'),
          function (button) {
            button.onclick = function () {
              var id = button.getAttribute('data-edit');
              var group = groups.filter(function (g) { return g.id === id; })[0];
              editing = id;
              name.value = group.name;
              tags.value = group.tags.join(', ');
              cancel.style.display = '';
              document.getElementById('groupSave').textContent = 'Save changes';
              name.focus();
            };
          }
        );

        Array.prototype.forEach.call(
          view.querySelectorAll('[data-drop]'),
          function (button) {
            /* Two clicks rather than a confirm() dialog: the console has no
             * modal anywhere, and a blocking dialog is worse than a button
             * that asks again. */
            button.onclick = function () {
              if (button.getAttribute('data-armed')) {
                api.del('/api/v1/drill-groups/' +
                  encodeURIComponent(button.getAttribute('data-drop')))
                  .then(function () { go('drillGroups'); })
                  .catch(function (err) {
                    msg.className = 'err';
                    msg.textContent = errorMessage(err);
                  });
                return;
              }
              button.setAttribute('data-armed', '1');
              button.textContent = 'Tap again to delete';
            };
          }
        );
      }).catch(function (e) { fail(view, e); });
    },

    /* One drill. The body is Markdown a human wrote, rendered as escaped
     * plain text in a <pre> — deliberately not parsed into HTML. A
     * Markdown renderer would be a dependency, a new injection surface,
     * and a way for file content to become markup; none of that is worth
     * paying for prose that reads perfectly well as text. */
    drill: function (view, slug) {
      Promise.all([
        api.get('/api/v1/drills/' + encodeURIComponent(slug)),
        api.get('/api/v1/drill-groups')
      ]).then(function (results) {
        var d = results[0];
        var groups = results[1];

        function isIn(group) {
          return group.drills.some(function (drill) {
            return drill.slug === d.slug;
          });
        }

        view.innerHTML =
          backLink('drills', 'Drill library') +
          '<h2>' + esc(d.title) + '</h2>' +
          '<div class="card">' +
            '<p class="muted" style="margin:0 0 12px">' +
              esc(focusLabel(d.focus)) + ' · ' + esc(ageBandLabel(d.ageBand)) +
              ' · ' + esc(d.durationMinutes) + ' min · ' + esc(d.author) +
              (d.sourceNote ? ' · ' + esc(d.sourceNote) : '') +
            '</p>' +
            '<pre style="white-space:pre-wrap;font:inherit;margin:0">' +
              esc(d.body) + '</pre>' +
          '</div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 8px;font-size:15px">Your groups</h3>' +
            (groups.length
              ? groups.map(function (group) {
                  /* The id goes in an attribute, never into the label —
                   * the label is the trainer's own text and is escaped
                   * like any other. */
                  return '<p style="margin:0 0 6px">' +
                    '<label style="display:flex;gap:8px;align-items:center">' +
                    '<input type="checkbox" data-group="' + esc(group.id) + '"' +
                    (isIn(group) ? ' checked' : '') + '>' +
                    '<span>' + esc(group.name) + '</span></label></p>';
                }).join('') +
                '<p><button id="groupAssign" class="primary">Save groups</button></p>' +
                '<p id="assignMsg" class="muted"></p>'
              : '<p class="muted">You have no groups yet. ' +
                '<button class="link" data-go="drillGroups">' +
                '<span>Make one</span></button> to start organising the ' +
                'library your way.</p>') +
          '</div>';

        var save = document.getElementById('groupAssign');
        if (!save) return;
        save.onclick = function () {
          var msg = document.getElementById('assignMsg');
          var checked = [];
          Array.prototype.forEach.call(
            view.querySelectorAll('[data-group]'),
            function (box) {
              if (box.checked) checked.push(box.getAttribute('data-group'));
            }
          );
          msg.className = 'muted';
          msg.textContent = 'Saving…';
          /* Sends the full desired state, not a diff — unticking a box has
           * to actually remove the drill, and the server replaces rather
           * than merges for the same reason. */
          api.put('/api/v1/drill-groups/assignments/drill', {
            slug: d.slug,
            groupIds: checked
          }).then(function () {
            msg.className = 'muted';
            msg.textContent = 'Saved.';
          }).catch(function (err) {
            msg.className = 'err';
            msg.textContent = errorMessage(err);
          });
        };
      }).catch(function (e) { fail(view, e); });
    },

    /* PT1 — redeem a code, and the list of teams it produces.
     *
     * GET /pt/team-links returns PtTeamAggregateView[], not the
     * PtTeamLinkRow[] the endpoint name suggests. Only currently-active
     * links come back at all, so there is no status to filter on here —
     * an earlier draft of this file filtered on `status === 'active'`, a
     * field the payload does not have, and rendered an empty table for
     * every trainer. */
    teams: function (view) {
      api.get('/api/v1/pt/team-links').then(function (teams) {
        view.innerHTML =
          '<h2>My teams</h2>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 6px;font-size:15px">Add a team</h3>' +
            '<p class="muted" style="margin:0 0 10px">A captain generates an ' +
            '8-character code and gives it to you. You cannot search for ' +
            'teams — the invitation only ever travels in that direction.</p>' +
            '<form id="redeemForm" style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<input id="redeemCode" maxlength="8" placeholder="ABCD1234" ' +
              'autocapitalize="characters" autocomplete="off" spellcheck="false" ' +
              'style="font:inherit;letter-spacing:.14em;text-transform:uppercase;' +
              'padding:9px 12px;border:1px solid var(--line);border-radius:8px;width:170px">' +
              '<button type="submit" class="primary">Redeem code</button>' +
            '</form>' +
            '<p id="redeemMsg" class="muted" style="margin:10px 0 0"></p>' +
          '</div>' +
          (teams.length ? teams.map(teamCard).join('')
                        : '<div class="card"><p class="muted">No teams yet. ' +
                          'Redeem a code above to get started.</p></div>');

        var form = document.getElementById('redeemForm');
        form.onsubmit = function (event) {
          event.preventDefault();
          var input = document.getElementById('redeemCode');
          var msg = document.getElementById('redeemMsg');
          var code = input.value.trim().toUpperCase();
          if (code.length !== 8) {
            msg.className = 'err';
            msg.textContent = 'A team code is exactly 8 characters.';
            return;
          }
          msg.className = 'muted';
          msg.textContent = 'Redeeming…';
          api.post('/api/v1/pt/team-links/redeem', { code: code })
            .then(function () { go('teams'); })
            .catch(function (e) {
              msg.className = 'err';
              msg.textContent = errorMessage(e);
            });
        };
      }).catch(function (e) { fail(view, e); });
    },

    /* PT2 — one team: the aggregate tier. Everything on this screen is
     * visible on the strength of the team link alone, which is why it is
     * deliberately thin: screen names, a pot total, a weekly goal. No
     * training data for anyone appears here. */
    team: function (view, teamId) {
      api.get('/api/v1/pt/team-links').then(function (teams) {
        var team = teams.filter(function (t) { return t.teamId === teamId; })[0];
        if (!team) {
          view.innerHTML = backLink('teams', 'My teams') +
            '<div class="card"><p>You are not linked to this team.</p>' +
            '<p class="muted">A captain can revoke a trainer link at any ' +
            'time, and does not have to give a reason.</p></div>';
          return;
        }

        var goal = team.activeWeeklyGoal;
        view.innerHTML =
          backLink('teams', 'My teams') +
          '<h2>' + esc(team.teamName) + '</h2>' +
          '<div class="card">' +
            '<p style="margin:0 0 4px"><strong>' + esc(team.teamPool.pointsTotal) +
            '</strong> points in the team pot</p>' +
            (goal
              ? '<p class="muted" style="margin:0"><span>This week</span>: ' + esc(goal.title) +
                ' — ' + esc(goal.teamProgressValue) + ' <span>out of</span> ' +
                esc(goal.targetValue) + ' ' + esc(metricLabel(goal.targetMetric)) +
                ', <span>ending on</span> ' + esc(goal.endDate) + '</p>'
              : '<p class="muted" style="margin:0">No weekly goal running.</p>') +
          '</div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 4px;font-size:15px"><span>Players in this team</span> (' +
            esc(team.rosterSize) + ')</h3>' +
            '<p class="muted" style="margin:0 0 12px">Screen names only. You ' +
            'see a player&rsquo;s training after their family says yes — ' +
            'each child is a separate decision.</p>' +
            '<table><tr><th>Player</th><th>Access</th><th></th></tr>' +
            team.roster.map(function (entry) {
              return '<tr><td>' + esc(entry.screenName) + '</td><td>' +
                consentBadge(entry.consentStatus) + '</td><td style="text-align:right">' +
                consentAction(entry) + '</td></tr>';
            }).join('') +
            '</table>' +
          '</div>';

        wireConsentButtons(view, teamId);
      }).catch(function (e) { fail(view, e); });
    },

    /* PT4 — one player, only ever reachable with an approved consent.
     * The server re-checks that on every call; this screen simply cannot
     * be opened without it. */
    player: function (view, playerId) {
      api.get('/api/v1/pt/players/' + encodeURIComponent(playerId))
        .then(function (p) {
          view.innerHTML =
            backLink('teams', 'My teams') +
            '<h2>' + esc(p.screenName) + '</h2>' +
            '<div class="card">' +
              '<p style="margin:0"><strong>' + esc(p.currentStreakCount) +
              '</strong>-day streak · longest ' + esc(p.longestStreakCount) +
              ' · last trained ' + esc(p.lastTrainedDate || 'never') + '</p>' +
            '</div>' +
            '<div class="card"><h3 style="margin:0 0 10px;font-size:15px">Training</h3>' +
              (p.trainingLog.length
                ? '<table><tr><th>When</th><th>Activity</th><th>Minutes</th></tr>' +
                  p.trainingLog.map(function (row) {
                    return '<tr><td>' + esc(row.loggedAt) + '</td><td>' +
                      esc(row.activityType) + '</td><td>' +
                      esc(row.durationMinutes) + '</td></tr>';
                  }).join('') + '</table>'
                : '<p class="muted">Nothing logged yet.</p>') +
            '</div>' +
            '<div class="card"><h3 style="margin:0 0 10px;font-size:15px">Badges</h3>' +
              (p.badges.length
                ? p.badges.map(function (b) {
                    return '<p style="margin:0 0 4px">' + esc(b.displayName) +
                      ' <span class="muted">— ' + esc(b.awardedAt) + '</span></p>';
                  }).join('')
                : '<p class="muted">No badges yet.</p>') +
            '</div>' +
            '<p class="muted">No real name, no contact details, no clips, no ' +
            'chat, and nowhere this player has been. That is the whole of ' +
            'what a trainer is shown.</p>';
        }).catch(function (e) { fail(view, e); });
    }
  };

  function teamCard(team) {
    var waiting = team.roster.filter(function (r) {
      return r.consentStatus === 'pending_review';
    }).length;
    var approved = team.roster.filter(function (r) {
      return r.consentStatus === 'approved';
    }).length;
    return '<div class="card">' +
      '<h3 style="margin:0 0 4px;font-size:15px">' + esc(team.teamName) + '</h3>' +
      '<p class="muted" style="margin:0 0 10px">' +
      esc(team.rosterSize) + ' <span>players on the roster</span> · ' +
      esc(approved) + ' <span>shared with you</span>' +
      (waiting ? ' · ' + esc(waiting) + ' <span>waiting for a parent</span>' : '') +
      '</p>' +
      '<button class="primary" data-go="team/' + esc(team.teamId) + '">Open team</button>' +
      '</div>';
  }

  function consentBadge(status) {
    if (status === 'approved') return '<span class="badge ok">Shared with you</span>';
    if (status === 'pending_review') return '<span class="badge warn">Waiting for a parent</span>';
    return '<span class="badge">Not shared</span>';
  }

  /* PT3's entry point.
   *
   * `pending_review` still offers no way to ASK AGAIN — chasing a family
   * that has already been asked is what the pending cap exists to
   * prevent, and a second request would only error.
   *
   * It does now offer a RESEND, which is a different thing and was asked
   * for after a real coach's email went unanswered (owner, 2026-08-13).
   * The distinction the copy has to carry: this re-sends the same
   * request to the same address because the message may never have
   * arrived, it does not ask the family a second time. The server caps
   * it at three per hour and rotates the review code, so the previous
   * link stops working. */
  function consentAction(entry) {
    if (entry.consentStatus === 'approved') {
      return '<button class="primary" data-go="player/' + esc(entry.playerId) +
             '">View training</button>';
    }
    if (entry.consentStatus === 'pending_review') {
      return '<span class="muted">Asked — it is their decision</span> ' +
        '<button data-resend="' + esc(entry.playerId) + '">Send the email again</button>';
    }
    return '<button data-consent="' + esc(entry.playerId) + '">Ask for access</button>';
  }

  function wireResendButtons(view) {
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-resend]'),
      function (button) {
        button.onclick = function () {
          button.disabled = true;
          button.textContent = 'Sending…';
          api.post('/api/v1/pt/players/' +
                   encodeURIComponent(button.getAttribute('data-resend')) +
                   '/consent-requests/resend')
            .then(function () {
              button.textContent = 'Sent again';
            })
            .catch(function (err) {
              button.disabled = false;
              button.textContent = errorMessage(err);
            });
        };
      }
    );
  }

  function wireConsentButtons(view, teamId) {
    wireResendButtons(view);
    Array.prototype.forEach.call(
      view.querySelectorAll('[data-consent]'),
      function (button) {
        button.onclick = function () {
          var playerId = button.getAttribute('data-consent');
          button.disabled = true;
          button.textContent = 'Asking…';
          api.post('/api/v1/pt/players/' + encodeURIComponent(playerId) +
                   '/consent-requests')
            .then(function () { go('team/' + teamId); })
            .catch(function (e) {
              button.disabled = false;
              button.textContent = 'Ask for access';
              alertInline(button, errorMessage(e));
            });
        };
      }
    );
  }

  function fail(view, e) {
    if (e && e.unauthenticated) return start();

    /* One error gets a way out rather than only an explanation.
     *
     * A trainer who has just signed in for the first time hits this on
     * three tabs, and the fix is one screen away — so send them there
     * instead of making them find it. `data-go` is handled by the
     * delegated click listener above, so this needs no wiring.
     *
     * Deliberately only this code: a button on an arbitrary failure is
     * a guess about what the reader should do next, and a wrong guess is
     * worse than none. */
    var action = errorCode(e) === 'drill_library_requires_team_link'
      ? '<p><button class="primary" data-go="teams">Go to My teams</button></p>'
      : '';
    view.innerHTML = '<p class="err">' + esc(errorMessage(e)) + '</p>' + action;
  }

  el('logout').onclick = function () {
    fetch('/api/v1/staff-auth/logout', { method: 'POST', credentials: 'same-origin' })
      .then(function () { location.reload(); });
  };

  /* Role comes from GET /staff-auth/session, which answers 200 whether or
   * not you are signed in.
   *
   * This used to probe GET /admin/session and read a 401 as "signed out".
   * It worked, and it cost an error row on every signed-out page load —
   * the admin Errors tab filled with the console asking a question it was
   * designed to ask. An expected answer should not travel as an exception.
   *
   * Nothing here is a security boundary: every /admin and /pt route keeps
   * its own guard, and those guards decide access. This only decides which
   * navigation to draw. */
  /**
   * ADR-0031 — redeeming an account-link challenge.
   *
   * The token arrives as `?link=<token>` from the app. It is moved into
   * sessionStorage and stripped from the URL immediately, for two
   * reasons: it must survive the SSO round trip that follows when the
   * operator is not signed in yet, and a live ticket sitting in a
   * visible address bar is the kind of thing that gets pasted into a
   * chat window.
   *
   * It carries no authority on its own — possessing it lets you attach
   * *your own* staff account to that player and nothing else, and the
   * resulting link grants nothing either way (ADR-0031 Decision 3). The
   * care here is proportionate to it being a one-shot ticket, not to it
   * being a credential.
   */
  function captureLinkToken() {
    var match = /[?&]link=([^&]+)/.exec(location.search || '');
    if (!match) return;
    try {
      sessionStorage.setItem('skillstreak.linkToken', decodeURIComponent(match[1]));
    } catch (e) { /* private mode: the redeem below simply will not fire */ }
    /* Strip it from the address bar without reloading. */
    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) { /* older browser: harmless, the token is already stored */ }
  }

  function takeLinkToken() {
    try {
      var t = sessionStorage.getItem('skillstreak.linkToken');
      sessionStorage.removeItem('skillstreak.linkToken');
      return t || null;
    } catch (e) { return null; }
  }

  /** One-line result, drawn where the operator is already looking. */
  function sayLinkResult(text) {
    var who = el('who');
    if (!who) return;
    var note = document.createElement('span');
    note.className = 'linkNote';
    note.textContent = ' · ' + text;
    who.appendChild(note);
    setTimeout(function () {
      if (note.parentNode) note.parentNode.removeChild(note);
    }, 8000);
  }

  function redeemLinkIfPending() {
    var token = takeLinkToken();
    if (!token) return;
    api.post('/api/v1/staff/account-link/complete', { token: token })
      .then(function () {
        sayLinkResult('Linked to your player account');
      })
      .catch(function () {
        /* One message for every refusal, matching the server: expired,
         * already used, already linked and under-age are deliberately
         * indistinguishable. */
        sayLinkResult('That link request could not be completed');
      });
  }

  function start() {
    captureLinkToken();
    api.get('/api/v1/staff-auth/session').then(function (session) {
      if (!session.authenticated) {
        show('login');
        return;
      }

      state.role = session.role === 'admin' ? 'admin' : 'pt';
      /* Admins start in admin mode; a trainer has only one surface, so for
       * them mode and role are always the same thing. */
      state.mode = state.role;
      state.lang = readLang();
      el('who').textContent =
        session.displayName || (state.role === 'admin' ? '' : 'Trainer');
      show('shell');

      /* Only after a session is confirmed — the endpoint is behind
       * StaffAuthGuard, so redeeming before sign-in would just 401 and
       * burn the token. */
      redeemLinkIfPending();

      if (state.role === 'admin') {
        /* Only admins ask for this, and only once we know they are one —
         * so the call can no longer 401 and can no longer log an error. */
        api.get('/api/v1/admin/session').then(function (adminSession) {
          var env = el('env');
          env.textContent = adminSession.environment || '—';
          env.className =
            'env' + (/prod/i.test(adminSession.environment || '') ? ' prod' : '');
        }).catch(function () {
          /* The badge is decoration; failing to draw it must not stop the
           * console loading. */
          el('env').textContent = '—';
        });
        go(returnTo() || (location.hash || '').replace('#', '') || 'graphs');
      } else {
        el('env').textContent = '—';
        go((location.hash || '').replace('#', '') || 'teams');
      }
    }).catch(function () {
      /* The one endpoint that should never fail did. Showing sign-in is
       * the only honest option — pretending to be signed in would produce
       * a console where every tab errors. */
      show('login');
      el('loginNote').textContent =
        'Could not reach the server. Try again in a moment.';
    });
  }

  start();
})();

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
      if (r.status === 401) throw { unauthenticated: true };
      if (!r.ok) {
        return r.json().then(function (b) { throw b; },
                             function () { throw { status: r.status }; });
      }
      return r.status === 204 ? null : r.json();
    });
  }

  var api = {
    get: function (path) { return request('GET', path); },
    post: function (path, body) { return request('POST', path, body); },
    del: function (path) { return request('DELETE', path); }
  };

  /* The send-list filters. `todo` is first and is the default, because
   * "who have I not contacted yet" is the question this page is opened to
   * answer once invitations start going out. */
  var SIGNUP_FILTERS = {
    todo: {
      label: 'To invite',
      match: function (row) { return !row.inviteSentAt; }
    },
    invited: {
      label: 'Already invited',
      match: function (row) { return !!row.inviteSentAt; }
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
    contribute: 'Wants to help build',
    trainer: 'Wants to be a trainer',
    other: 'Other'
  };

  /* Wire error codes → what a trainer should actually read. Anything not
   * listed falls back to the raw code, which is ugly but honest: inventing
   * reassuring copy for an error we did not anticipate is worse. */
  var ERROR_COPY = {
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
  var state = { role: null, session: null, tab: null };

  /* Which tabs a role sees. The server enforces all of it — every /admin
   * route is behind AdminAuthGuard regardless of what this array says, so
   * this is navigation, not security. */
  var TABS = {
    admin: [
      { id: 'stats', label: 'Statistics' },
      { id: 'graphs', label: 'Graphs' },
      { id: 'signups', label: 'Demo signups' },
      { id: 'errors', label: 'Errors' },
      { id: 'bugs', label: 'Bug reports' },
      { id: 'planning', label: 'Planning' }
    ],
    pt: [
      { id: 'teams', label: 'My teams' }
    ]
  };

  /* Detail routes belong to a tab without being one. Without this, opening
   * a team unlit the only nav item a trainer has, which reads as "you have
   * navigated out of the app". */
  var ROUTE_TAB = { team: 'teams', player: 'teams', graphs: 'graphs' };

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
  }

  function renderNav() {
    var nav = el('nav');
    nav.innerHTML = '';
    (TABS[state.role] || []).forEach(function (tab) {
      var b = document.createElement('button');
      b.textContent = tab.label;
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
  }

  window.addEventListener('hashchange', function () {
    var route = location.hash.replace('#', '');
    if (route && route !== state.tab) go(route);
  });

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
                  'Campaign', 'Note', 'Invited', 'UnsubscribeUrl'];
    var lines = [header.map(cell).join(',')].concat(rows.map(function (row) {
      return [row.createdAt, row.name, row.email,
              INTEREST_LABEL[row.interest] || row.interest, row.locale,
              row.campaign || '', row.note || '', row.inviteSentAt || '',
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
    return '<p><button class="link" data-go="' + esc(route) + '">← ' +
           esc(label) + '</button></p>';
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
    stats: function (view) {
      api.get('/api/v1/admin/usage-metrics').then(function (m) {
        var rows = Object.keys(m).filter(function (k) {
          return typeof m[k] === 'number';
        }).map(function (k) {
          return '<tr><td>' + esc(k) + '</td><td>' + esc(m[k]) + '</td></tr>';
        }).join('');
        view.innerHTML = '<h2>Statistics</h2><div class="card"><table>' +
          '<tr><th>Metric</th><th>Value</th></tr>' + rows + '</table></div>' +
          '<p class="muted">Aggregates only — ADR-0020 suppresses anything that could ' +
          'resolve to a single team or player.</p>';
      }).catch(function (e) { fail(view, e); });
    },

    /* Demo-event signups. Adult marketing data, kept in its own admin tab
     * with no path to anything about a player — see the entity docstring
     * for why that separation is structural rather than tidiness. */
    /* Link clicks and app-wide activity, drawn. Everything on this screen
     * is app-wide — there is no team or player dimension in the payload,
     * by ADR-0020 Decision 5, so there is nothing here to filter down to
     * an individual child even if someone wanted to. */
    graphs: function (view, daysArg) {
      var days = Number(daysArg) > 0 ? Number(daysArg) : 30;
      api.get('/api/v1/admin/analytics?days=' + days).then(function (data) {
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

          '<p class="muted">Counts only. No cookies, no third-party ' +
          'analytics, and nothing identifying a visitor — a click is a ' +
          'number against a link and a date, so these charts cannot be ' +
          'narrowed to a person or a team.</p>';
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
            '</strong> still to invite</p>' +
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
            '<th>Invited</th><th></th></tr>' +
            (rows.length ? rows.map(function (row) {
              return '<tr><td>' + esc(row.createdAt.slice(0, 10)) + '</td><td>' +
                esc(row.name) + '</td><td>' + esc(row.email) + '</td><td>' +
                esc(INTEREST_LABEL[row.interest] || row.interest) + '</td><td>' +
                esc(row.locale) + '</td><td>' + esc(row.campaign || '—') +
                '</td><td>' + (row.inviteSentAt
                  ? esc(row.inviteSentAt.slice(0, 10))
                  : '<span class="muted">not yet</span>') +
                '</td><td style="text-align:right"><button data-remove="' +
                esc(row.id) + '">Remove</button></td></tr>';
            }).join('')
              : '<tr><td colspan="8" class="muted">Nothing here.</td></tr>') +
            '</table></div>' +
          '<p class="muted">The CSV carries a personal unsubscribe link per ' +
          'row — put it in whatever you send, including a mail merge. ' +
          'Held on consent, so &ldquo;remove&rdquo; deletes the row outright. ' +
          'Nothing on this page is connected to any player or team.</p>';

        var exportButton = document.getElementById('exportCsv');
        if (exportButton) {
          exportButton.onclick = function () { downloadCsv(rows, filter); };
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
          return '<tr><td>' + esc(x.occurredAt) + '</td><td>' + esc(x.source) +
                 '</td><td>' + esc(x.statusCode || '') + '</td><td>' +
                 esc(ERROR_NAME_LABEL[x.errorName] || x.errorName || '') +
                 '</td><td>' + esc(x.message) + '</td></tr>';
        }).join('');
        view.innerHTML = '<h2>Errors</h2><div class="card"><table>' +
          '<tr><th>When</th><th>Source</th><th>Status</th><th>Why</th><th>Message</th></tr>' +
          (rows || '<tr><td colspan="5" class="muted">Nothing logged.</td></tr>') +
          '</table></div>' +
          '<p class="muted">Every 401 answers the caller with the same ' +
          'generic message on purpose — telling someone &ldquo;expired&rdquo; ' +
          'rather than &ldquo;invalid&rdquo; would confirm their token was ' +
          'correctly signed. The <strong>Why</strong> column is where the ' +
          'difference is kept.</p>';
      }).catch(function (e) { fail(view, e); });
    },

    bugs: function (view) {
      api.get('/api/v1/admin/bug-reports').then(function (r) {
        var rows = (r.reports || r.rows || []).map(function (x) {
          return '<tr><td>' + esc(x.createdAt) + '</td><td>' + esc(x.screenName) +
                 '</td><td>' + esc(x.category) + '</td><td>' + esc(x.status) +
                 '</td><td>' + esc(x.description || '') + '</td></tr>';
        }).join('');
        view.innerHTML = '<h2>Bug reports</h2><div class="card"><table>' +
          '<tr><th>When</th><th>Reporter</th><th>Category</th><th>Status</th><th>What happened</th></tr>' +
          (rows || '<tr><td colspan="5" class="muted">No reports.</td></tr>') +
          '</table></div>';
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
          view.innerHTML = '<h2>Planning</h2><div class="card"><p>This section needs you to confirm it is you.</p>' +
            '<p class="muted">You will come straight back here.</p>' +
            '<a class="sso" style="max-width:260px" href="/api/v1/staff-auth/google/step-up">Sign in again</a></div>';
          return;
        }
        fail(view, e);
      });
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
              ? '<p class="muted" style="margin:0">This week: ' + esc(goal.title) +
                ' — ' + esc(goal.teamProgressValue) + ' of ' + esc(goal.targetValue) +
                ' ' + esc(goal.targetMetric) + ', ending ' + esc(goal.endDate) + '</p>'
              : '<p class="muted" style="margin:0">No weekly goal running.</p>') +
          '</div>' +
          '<div class="card">' +
            '<h3 style="margin:0 0 4px;font-size:15px">Players (' +
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
      esc(plural(team.rosterSize, 'player')) + ' · ' + esc(approved) +
      ' shared with you' +
      (waiting ? ' · ' + esc(waiting) + ' waiting for a parent' : '') + '</p>' +
      '<button class="primary" data-go="team/' + esc(team.teamId) + '">Open team</button>' +
      '</div>';
  }

  function consentBadge(status) {
    if (status === 'approved') return '<span class="badge ok">Shared with you</span>';
    if (status === 'pending_review') return '<span class="badge warn">Waiting for a parent</span>';
    return '<span class="badge">Not shared</span>';
  }

  /* PT3's entry point. `pending_review` is deliberately not re-requestable
   * from here: chasing a family that has already been asked is exactly what
   * the server's rate limit and pending cap exist to prevent, so the UI
   * should not offer a button whose only outcome is an error. */
  function consentAction(entry) {
    if (entry.consentStatus === 'approved') {
      return '<button class="primary" data-go="player/' + esc(entry.playerId) +
             '">View training</button>';
    }
    if (entry.consentStatus === 'pending_review') {
      return '<span class="muted">Asked — it is their decision</span>';
    }
    return '<button data-consent="' + esc(entry.playerId) + '">Ask for access</button>';
  }

  function wireConsentButtons(view, teamId) {
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
    view.innerHTML = '<p class="err">' + esc(errorMessage(e)) + '</p>';
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
  function start() {
    api.get('/api/v1/staff-auth/session').then(function (session) {
      if (!session.authenticated) {
        show('login');
        return;
      }

      state.role = session.role === 'admin' ? 'admin' : 'pt';
      el('who').textContent =
        session.displayName || (state.role === 'admin' ? '' : 'Trainer');
      show('shell');

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
        go((location.hash || '').replace('#', '') || 'stats');
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

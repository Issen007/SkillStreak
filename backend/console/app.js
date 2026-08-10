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
    post: function (path, body) { return request('POST', path, body); }
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
  var ROUTE_TAB = { team: 'teams', player: 'teams' };

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

    errors: function (view) {
      api.get('/api/v1/admin/errors').then(function (r) {
        var rows = (r.entries || r.rows || []).slice(0, 50).map(function (x) {
          return '<tr><td>' + esc(x.occurredAt) + '</td><td>' + esc(x.source) +
                 '</td><td>' + esc(x.statusCode || '') + '</td><td>' + esc(x.message) + '</td></tr>';
        }).join('');
        view.innerHTML = '<h2>Errors</h2><div class="card"><table>' +
          '<tr><th>When</th><th>Source</th><th>Status</th><th>Message</th></tr>' +
          (rows || '<tr><td colspan="4" class="muted">Nothing logged.</td></tr>') +
          '</table></div>';
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
              var note = document.createElement('div');
              note.className = 'err';
              note.style.fontSize = '13px';
              note.textContent = errorMessage(e);
              button.parentNode.appendChild(note);
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

  /* Role is discovered by asking, not assumed: GET /admin/session succeeds
   * only for an admin, so a 403/401 there means this account is a PT (or
   * has no access at all, which the API decides — not this page). */
  function start() {
    api.get('/api/v1/admin/session').then(function (session) {
      state.role = 'admin';
      state.session = session;
      el('who').textContent = session.displayName || '';
      var env = el('env');
      env.textContent = session.environment || '—';
      env.className = 'env' + (/prod/i.test(session.environment || '') ? ' prod' : '');
      show('shell');
      go((location.hash || '').replace('#', '') || 'stats');
    }).catch(function (e) {
      if (e && e.unauthenticated) { show('login'); return; }
      // Authenticated but not an admin — try the PT surface.
      api.get('/api/v1/pt/team-links').then(function () {
        state.role = 'pt';
        el('who').textContent = 'Trainer';
        el('env').textContent = '—';
        show('shell');
        go('teams');
      }).catch(function () {
        show('login');
        el('loginNote').textContent =
          'That account is signed in but has no staff access yet.';
      });
    });
  }

  start();
})();

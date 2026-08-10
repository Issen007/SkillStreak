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

  var api = {
    get: function (path) {
      return fetch(path, { credentials: 'same-origin' }).then(function (r) {
        if (r.status === 401) throw { unauthenticated: true };
        if (!r.ok) return r.json().then(function (b) { throw b; }, function () { throw { status: r.status }; });
        return r.json();
      });
    }
  };

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
      b.className = tab.id === state.tab ? 'is-active' : '';
      b.onclick = function () { go(tab.id); };
      nav.appendChild(b);
    });
  }

  function go(tabId) {
    state.tab = tabId;
    location.hash = tabId;
    renderNav();
    var view = el('view');
    view.innerHTML = '<p class="muted">Loading…</p>';
    var render = VIEWS[tabId];
    if (!render) { view.innerHTML = ''; return; }
    render(view);
  }

  function stub(title, why) {
    return '<div class="card stub"><h3>' + title + '</h3>' +
           '<p class="muted">' + why + '</p></div>';
  }

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

    teams: function (view) {
      api.get('/api/v1/pt/team-links').then(function (links) {
        var rows = (links || []).filter(function (l) { return l.status === 'active'; })
          .map(function (l) { return '<tr><td>' + esc(l.teamId) + '</td><td>' + esc(l.createdAt) + '</td></tr>'; })
          .join('');
        view.innerHTML = '<h2>My teams</h2><div class="card"><table>' +
          '<tr><th>Team</th><th>Linked since</th></tr>' +
          (rows || '<tr><td colspan="2" class="muted">No active team links. Ask a captain for a code.</td></tr>') +
          '</table></div>' +
          stub('Redeem a team code (PT1)', 'Designed in phase8-pt-flows.md §2 — not built in this shell.') +
          stub('Roster and consent requests (PT2/PT3)', 'Designed in §3 and §4 — not built in this shell.');
      }).catch(function (e) { fail(view, e); });
    }
  };

  function fail(view, e) {
    if (e && e.unauthenticated) return start();
    var code = (e && e.error && e.error.code) || (e && e.status) || 'unknown';
    view.innerHTML = '<p class="err">Could not load this section (' + esc(code) + ').</p>';
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

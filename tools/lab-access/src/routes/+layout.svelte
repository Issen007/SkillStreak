<script lang="ts">
  import { page } from '$app/stores';
  let { children } = $props();
</script>

<div class="shell">
  <h1>🥍 SkillStreak — Lab Access</h1>

  <nav class="tabs">
    <a href="/" class:active={$page.url.pathname === '/'}>QR-kod</a>
    <a href="/simulator" class:active={$page.url.pathname === '/simulator'}
      >Simulator</a
    >
  </nav>

  {@render children()}
</div>

<style>
  :global(body) {
    margin: 0;
    background: #14141f;
    color: #f4f4f8;
    font-family:
      system-ui,
      -apple-system,
      'Segoe UI',
      sans-serif;
  }

  .shell {
    max-width: 760px;
    margin: 0 auto;
    padding: 40px 20px 80px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .tabs {
    display: flex;
    gap: 8px;
    margin: 20px 0 28px;
  }

  .tabs a {
    color: #c3c3d4;
    text-decoration: none;
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid #2c2c3d;
    background: #1e1e2c;
  }

  .tabs a:hover {
    background: #262636;
  }

  .tabs a.active {
    color: #14141f;
    background: #f6c744;
    border-color: #f6c744;
    font-weight: 600;
  }
</style>

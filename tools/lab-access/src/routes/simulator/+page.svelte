<script lang="ts">
  import type { StatusResponse } from '../api/status/+server';

  const POLL_INTERVAL_MS = 3000;

  let status = $state<StatusResponse | null>(null);
  let device = $state<'iphone' | 'android'>('iphone');
  // Bumped whenever the iframe should hard-reload (e.g. after the Expo web
  // bundler comes up) -- the `key`-on-src trick alone won't refetch an
  // iframe pointed at the exact same URL.
  let reloadToken = $state(0);

  // null = following auto-detected network (default); set once the user
  // types their own address, e.g. a different Wi-Fi, a phone hotspot, or a
  // tunnel URL that auto-detection could never know about.
  let manualUrl = $state<string | null>(null);
  let urlInput = $state('');
  let customHealthy = $state(false);

  const webUrl = $derived(status?.webUrl ?? null);
  const webHealthy = $derived(status?.webHealthy ?? false);
  const effectiveUrl = $derived(manualUrl ?? webUrl);
  const effectiveHealthy = $derived(manualUrl ? customHealthy : webHealthy);

  async function refresh() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error(`status ${response.status}`);
      status = (await response.json()) as StatusResponse;
    } catch {
      // Network errors are already surfaced in detail on the QR tab; here
      // a stale/red status dot is enough signal.
    }
  }

  $effect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  // Keep the text field in sync with auto-detection right up until the
  // user overrides it -- once manualUrl is set, this stops touching it.
  $effect(() => {
    if (manualUrl === null && webUrl) {
      urlInput = webUrl;
    }
  });

  // A custom URL wasn't detected by this tool, so it needs its own
  // reachability check -- done client-side (no-cors: we only care whether
  // the request resolves at all, not what it returns) rather than routing
  // arbitrary user-typed addresses through the server.
  async function probeCustomUrl(url: string) {
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      customHealthy = true;
    } catch {
      customHealthy = false;
    }
  }

  $effect(() => {
    const url = manualUrl;
    if (!url) return;
    void probeCustomUrl(url);
    const interval = setInterval(() => void probeCustomUrl(url), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  function normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  }

  function applyUrl() {
    const normalized = normalizeUrl(urlInput);
    if (!normalized) return;
    urlInput = normalized;
    manualUrl = normalized;
  }

  function useAutoUrl() {
    manualUrl = null;
    if (webUrl) urlInput = webUrl;
  }

  function reload() {
    reloadToken += 1;
  }
</script>

<svelte:head>
  <title>SkillStreak — Simulator</title>
</svelte:head>

<p class="subtitle">
  Live förhandsvisning av appen i webbläsaren via Expo web — kör
  <code>npx expo start --web --lan</code> i <code>mobile/</code> för att
  starta den.
</p>

<div class="url-row">
  <input
    class="url-input"
    type="text"
    placeholder="192.168.1.23:8081"
    bind:value={urlInput}
    onkeydown={(e) => e.key === 'Enter' && applyUrl()}
  />
  <button class="apply" onclick={applyUrl}>Använd</button>
  <button class="auto" onclick={useAutoUrl} disabled={manualUrl === null}
    >Auto</button
  >
</div>

<div class="toolbar">
  <div class="toggle">
    <button class:active={device === 'iphone'} onclick={() => (device = 'iphone')}
      >iPhone</button
    >
    <button
      class:active={device === 'android'}
      onclick={() => (device = 'android')}>Android</button
    >
  </div>
  <button class="reload" onclick={reload} disabled={!effectiveUrl}
    >Ladda om</button
  >
</div>

{#if effectiveUrl}
  <div class="status-row">
    <span
      class="dot"
      class:dot-ok={effectiveHealthy}
      class:dot-bad={!effectiveHealthy}
    ></span>
    <span
      >{effectiveHealthy
        ? 'Expo web svarar'
        : 'Expo web-servern svarar inte på denna adress än'}</span
    >
    <code class="value">{effectiveUrl}</code>
    {#if manualUrl}
      <span class="manual-tag">manuell</span>
    {/if}
  </div>

  <div class="frame frame-{device}">
    {#if device === 'iphone'}
      <div class="notch"></div>
    {:else}
      <div class="punch-hole"></div>
    {/if}
    <div class="screen">
      {#if effectiveHealthy}
        {#key `${effectiveUrl}-${reloadToken}`}
          <iframe src={effectiveUrl} title="SkillStreak simulator"></iframe>
        {/key}
      {:else}
        <div class="placeholder">
          <p>Väntar på Expo web-servern…</p>
          <p class="hint">
            Starta den med <code>npx expo start --web --lan</code> i
            <code>mobile/</code>, eller skriv in rätt adress ovan.
          </p>
        </div>
      {/if}
    </div>
  </div>
{:else}
  <p class="loading">Letar efter nätverk…</p>
{/if}

<style>
  .subtitle {
    color: #a5a5b8;
    font-size: 14px;
    margin-top: 0;
    margin-bottom: 24px;
  }

  .subtitle code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: #1e1e2c;
    padding: 2px 5px;
    border-radius: 4px;
  }

  .loading {
    color: #a5a5b8;
  }

  .url-row {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }

  .url-input {
    flex: 1;
    min-width: 0;
    background: #1e1e2c;
    border: 1px solid #2c2c3d;
    color: #f4f4f8;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  }

  .url-input:focus {
    outline: none;
    border-color: #f6c744;
  }

  .apply,
  .auto {
    background: #1e1e2c;
    border: 1px solid #2c2c3d;
    color: #f4f4f8;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .apply:hover,
  .auto:hover:not(:disabled) {
    background: #262636;
  }

  .auto:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .manual-tag {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #14141f;
    background: #f6c744;
    border-radius: 999px;
    padding: 2px 8px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .toggle {
    display: flex;
    gap: 6px;
  }

  .toggle button,
  .reload {
    background: #1e1e2c;
    border: 1px solid #2c2c3d;
    color: #f4f4f8;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    cursor: pointer;
  }

  .toggle button:hover,
  .reload:hover:not(:disabled) {
    background: #262636;
  }

  .toggle button.active {
    border-color: #f6c744;
    background: #2a2717;
  }

  .reload:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #c3c3d4;
    margin-bottom: 20px;
  }

  .status-row .value {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
    color: #8a8aa0;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-ok {
    background: #4ade80;
  }

  .dot-bad {
    background: #f87171;
  }

  /* Device frames are deliberately simple CSS chrome around a real,
     live-running app -- not an attempt at pixel-accurate device
     emulation, just enough visual context to read as "this is the
     phone app" during a demo. */
  .frame {
    position: relative;
    background: #0a0a0a;
    margin: 0 auto;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
  }

  .frame-iphone {
    width: 320px;
    height: 660px;
    border-radius: 46px;
    border: 10px solid #0a0a0a;
    padding: 10px;
  }

  .frame-iphone .notch {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: 120px;
    height: 22px;
    background: #0a0a0a;
    border-radius: 0 0 16px 16px;
    z-index: 1;
  }

  .frame-android {
    width: 320px;
    height: 660px;
    border-radius: 22px;
    border: 8px solid #0a0a0a;
    padding: 8px;
  }

  .frame-android .punch-hole {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #0a0a0a;
    border: 2px solid #222;
    z-index: 1;
  }

  .screen {
    width: 100%;
    height: 100%;
    background: #fff;
    border-radius: inherit;
    overflow: hidden;
  }

  .screen iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .placeholder {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 20px;
    color: #666;
    font-size: 13px;
  }

  .placeholder .hint {
    font-size: 12px;
    color: #999;
    margin-top: 8px;
  }

  .placeholder code {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: #eee;
    padding: 2px 5px;
    border-radius: 4px;
  }
</style>

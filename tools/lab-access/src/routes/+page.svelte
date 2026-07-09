<script lang="ts">
  import QRCode from 'qrcode';
  import type { StatusResponse } from './api/status/+server';

  const POLL_INTERVAL_MS = 3000;

  let status = $state<StatusResponse | null>(null);
  let manualOverride = $state<string | null>(null);
  let qrSvg = $state('');
  let copiedField = $state<string | null>(null);
  let fetchError = $state<string | null>(null);
  let lastRenderedExpoUrl = $state<string | null>(null);

  const selectedAddress = $derived(status?.selected ?? null);
  const expoUrl = $derived(status?.expoUrl ?? null);
  const apiUrl = $derived(status?.apiUrl ?? null);
  const apiHealthy = $derived(status?.apiHealthy ?? false);
  const candidates = $derived(status?.candidates ?? []);
  const expoStartCommand = $derived(
    apiUrl ? `EXPO_PUBLIC_API_URL="${apiUrl}" npx expo start --lan` : '',
  );

  async function refresh() {
    try {
      const query = manualOverride
        ? `?ip=${encodeURIComponent(manualOverride)}`
        : '';
      const response = await fetch(`/api/status${query}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      status = (await response.json()) as StatusResponse;
      fetchError = null;
    } catch {
      fetchError = 'Kunde inte läsa nätverksstatus. Försöker igen…';
    }
  }

  // Poll on mount, then every 3s -- this is the "automatic" half of the
  // ask: leave this page open and it picks up a network/IP change on its
  // own, no manual refresh needed mid-demo.
  $effect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  });

  // Regenerate the QR only when the underlying URL actually changes (not on
  // every 3s poll tick) -- avoids a visible flicker on an otherwise-idle
  // screen during a demo.
  $effect(() => {
    const url = expoUrl;
    if (!url || url === lastRenderedExpoUrl) return;
    lastRenderedExpoUrl = url;
    void QRCode.toString(url, { type: 'svg', margin: 1, width: 288 }).then(
      (svg) => {
        qrSvg = svg;
      },
    );
  });

  function selectCandidate(address: string) {
    manualOverride = address;
    void refresh();
  }

  function useAutoDetect() {
    manualOverride = null;
    void refresh();
  }

  async function copy(text: string, field: string) {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copiedField = field;
    setTimeout(() => {
      if (copiedField === field) copiedField = null;
    }, 1500);
  }
</script>

<svelte:head>
  <title>SkillStreak — Lab Access</title>
</svelte:head>

<main>
  <h1>🥍 SkillStreak — Lab Access</h1>
  <p class="subtitle">
    Håll den här sidan öppen under en demo — QR-koden uppdateras automatiskt
    om du byter nätverk.
  </p>

  {#if fetchError}
    <p class="error">{fetchError}</p>
  {/if}

  {#if selectedAddress}
    <div class="layout">
      <div class="qr-card">
        {#if qrSvg}
          {@html qrSvg}
        {/if}
        <p class="qr-caption">Skanna med kameran eller i Expo Go</p>
      </div>

      <div class="info">
        <div class="row">
          <span class="label">Nätverk</span>
          <span class="value">{selectedAddress}</span>
          <span
            class="dot"
            class:dot-ok={apiHealthy}
            class:dot-bad={!apiHealthy}
            title={apiHealthy
              ? 'Backend svarar på /health'
              : 'Backend svarar inte på denna adress just nu'}
          ></span>
        </div>

        <div class="row">
          <span class="label">Expo Go-länk</span>
          <code class="value">{expoUrl}</code>
          <button onclick={() => copy(expoUrl ?? '', 'expo')}>
            {copiedField === 'expo' ? 'Kopierat!' : 'Kopiera'}
          </button>
        </div>

        <div class="row">
          <span class="label">Starta Expo mot detta nätverk</span>
          <code class="value command">{expoStartCommand}</code>
          <button onclick={() => copy(expoStartCommand, 'command')}>
            {copiedField === 'command' ? 'Kopierat!' : 'Kopiera'}
          </button>
        </div>
      </div>
    </div>

    {#if candidates.length > 1}
      <details class="candidates">
        <summary>
          Fel nätverk valt? Välj manuellt ({candidates.length} hittade)
        </summary>
        <ul>
          <li>
            <button
              class="candidate-button"
              class:active={manualOverride === null}
              onclick={useAutoDetect}
            >
              Auto (rekommenderas)
            </button>
          </li>
          {#each candidates as candidate (candidate.interfaceName + candidate.address)}
            <li>
              <button
                class="candidate-button"
                class:active={manualOverride === candidate.address}
                onclick={() => selectCandidate(candidate.address)}
              >
                {candidate.interfaceName} — {candidate.address}
              </button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  {:else if status}
    <p class="error">
      Inget nätverksgränssnitt hittades. Kontrollera att den här datorn är
      ansluten till Wi-Fi.
    </p>
  {:else}
    <p class="loading">Letar efter nätverk…</p>
  {/if}
</main>

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

  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 40px 20px 80px;
  }

  h1 {
    font-size: 22px;
    margin-bottom: 4px;
  }

  .subtitle {
    color: #a5a5b8;
    font-size: 14px;
    margin-top: 0;
    margin-bottom: 32px;
  }

  .loading {
    color: #a5a5b8;
  }

  .error {
    background: #3a1f24;
    border: 1px solid #7a3b42;
    color: #ffb4bd;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
  }

  .layout {
    display: flex;
    gap: 28px;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .qr-card {
    background: #ffffff;
    border-radius: 16px;
    padding: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  .qr-card :global(svg) {
    display: block;
    width: 240px;
    height: 240px;
  }

  .qr-caption {
    color: #444;
    font-size: 12px;
    margin: 8px 0 0;
  }

  .info {
    flex: 1;
    min-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #1e1e2c;
    border: 1px solid #2c2c3d;
    border-radius: 10px;
    padding: 12px 14px;
    position: relative;
  }

  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8a8aa0;
  }

  .value {
    font-size: 14px;
    word-break: break-all;
  }

  code.value {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    background: #14141f;
    padding: 6px 8px;
    border-radius: 6px;
  }

  .command {
    font-size: 12px;
  }

  .row button {
    align-self: flex-start;
    margin-top: 4px;
    background: #34344a;
    color: #f4f4f8;
    border: none;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .row button:hover {
    background: #40405a;
  }

  .dot {
    position: absolute;
    top: 12px;
    right: 14px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .dot-ok {
    background: #4ade80;
  }

  .dot-bad {
    background: #f87171;
  }

  .candidates {
    margin-top: 28px;
    font-size: 13px;
    color: #c3c3d4;
  }

  .candidates summary {
    cursor: pointer;
  }

  .candidates ul {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .candidate-button {
    width: 100%;
    text-align: left;
    background: #1e1e2c;
    border: 1px solid #2c2c3d;
    color: #f4f4f8;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
  }

  .candidate-button.active {
    border-color: #f6c744;
    background: #2a2717;
  }
</style>

<script lang="ts" module>
  /** 24-unit stroke icons, drawn for the drawer; they inherit the text colour. */
  const PATHS = {
    search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4',
    clip: 'M20 11.5 12.4 19a5 5 0 0 1-7.1-7.1l7.8-7.7a3.4 3.4 0 0 1 4.8 4.8l-7.8 7.7a1.7 1.7 0 0 1-2.4-2.4l7-7',
    mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v3',
    send: 'M5 12h14m-6-6 6 6-6 6',
    copy: 'M9 9h10v11H9zM5 15V4h10',
    open: 'M14 4h6v6m0-6-9 9M18 14v6H4V6h6',
    pin: 'M9 4h6l-1 6 4 4H6l4-4-1-6Zm3 10v6',
    lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
    trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
    close: 'M6 6l12 12M18 6 6 18',
    recent: 'M4 6h16M4 12h16M4 18h10',
    topics: 'M4 5h7v6H4zM13 5h7v6h-7zM4 13h7v6H4zM13 13h7v6h-7z',
    ask: 'M5 5h14v10H9l-4 4z',
    download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
    back: 'M19 12H5m6-6-6 6 6 6',
    check: 'M5 12.5 10 17 19 7',
    stop: 'M7 7h10v10H7z',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 18, label }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={label ? undefined : 'true'}
  role={label ? 'img' : undefined}
  aria-label={label}
>
  <path d={PATHS[name]} />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>

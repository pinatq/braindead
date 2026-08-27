/// <reference types="vite/client" />

// Pozwala używać elementu <webview> Electrona w JSX.
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string
        allowpopups?: string
        partition?: string
        preload?: string
        useragent?: string
      },
      HTMLElement
    >
  }
}

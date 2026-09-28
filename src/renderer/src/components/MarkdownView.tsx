import { useMemo } from 'react'
import type { RefObject } from 'react'
import MarkdownIt from 'markdown-it'

// Pliki są niezaufane: surowy HTML pozostaje tekstem, parser odrzuca niebezpieczne URL-e.
const markdown = new MarkdownIt({ html: false })
markdown.renderer.rules.link_open = (tokens, idx, options, _env, renderer) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return renderer.renderToken(tokens, idx, options)
}

export default function MarkdownView({ text, innerRef }: {
  text: string
  innerRef: RefObject<HTMLDivElement | null>
}) {
  const html = useMemo(() => markdown.render(text), [text])
  return <div ref={innerRef} className="viewer-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

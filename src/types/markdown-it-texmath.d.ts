declare module 'markdown-it-texmath' {
  import type MarkdownIt from 'markdown-it'
  import type katex from 'katex'

  type TexmathOptions = {
    engine: typeof katex
    delimiters?: 'dollars' | 'brackets' | Array<'dollars' | 'brackets' | 'beg_end'>
    katexOptions?: katex.KatexOptions
    outerSpace?: boolean
  }

  const texmath: MarkdownIt.PluginWithOptions<TexmathOptions>
  export default texmath
}

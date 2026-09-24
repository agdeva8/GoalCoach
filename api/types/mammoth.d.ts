declare module 'mammoth' {
  interface ExtractResult {
    value: string
    messages: Array<{ type: string; message: string }>
  }
  function extractRawText(opts: { buffer: Buffer }): Promise<ExtractResult>
  export = { extractRawText }
}

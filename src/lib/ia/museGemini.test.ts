import { describe, expect, it } from 'vitest'
import { deMuse, esquemaJson, paraMuse } from './museGemini'

describe('paraMuse', () => {
  it('leva system, histórico e pergunta como mensagens de chat', () => {
    const corpo = paraMuse({
      systemInstruction: { parts: [{ text: 'Você é o copiloto.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'oi' }] },
        { role: 'model', parts: [{ text: 'olá' }] },
        { role: 'user', parts: [{ text: 'quanto vendi?' }] },
      ],
      generationConfig: { temperature: 0.2 },
    })
    expect(corpo.messages).toEqual([
      { role: 'system', content: 'Você é o copiloto.' },
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'olá' },
      { role: 'user', content: 'quanto vendi?' },
    ])
    expect(corpo.temperature).toBe(0.2)
    expect(corpo.tools).toBeUndefined()
  })

  it('casa chamada e resposta de ferramenta pelo mesmo id', () => {
    const corpo = paraMuse({
      contents: [
        { role: 'user', parts: [{ text: 'saldo do blackout e do screen?' }] },
        { role: 'model', parts: [
          { functionCall: { name: 'saldo', args: { nome: 'blackout' } } },
          { functionCall: { name: 'saldo', args: { nome: 'screen' } } },
        ] },
        { role: 'user', parts: [
          { functionResponse: { name: 'saldo', response: { resultado: 12 } } },
          { functionResponse: { name: 'saldo', response: { resultado: 7 } } },
        ] },
      ],
      tools: [{ functionDeclarations: [{ name: 'saldo', description: 'Saldo', parameters: { type: 'OBJECT', properties: { nome: { type: 'STRING' } } } }] }],
    })
    const msgs = corpo.messages as Record<string, unknown>[]
    const chamadas = msgs[1].tool_calls as { id: string; function: { arguments: string } }[]
    expect(chamadas.map((c) => c.id)).toEqual(['call_0', 'call_1'])
    expect(JSON.parse(chamadas[0].function.arguments)).toEqual({ nome: 'blackout' })
    expect(msgs.slice(2)).toEqual([
      { role: 'tool', tool_call_id: 'call_0', content: '{"resultado":12}' },
      { role: 'tool', tool_call_id: 'call_1', content: '{"resultado":7}' },
    ])
    const [tool] = corpo.tools as { function: { parameters: { type: string; properties: { nome: { type: string } } } } }[]
    expect(tool.function.parameters.type).toBe('object')
    expect(tool.function.parameters.properties.nome.type).toBe('string')
  })

  it('mode NONE não envia ferramentas (o Muse só aceita tool_choice auto)', () => {
    const corpo = paraMuse({
      contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
      tools: [{ functionDeclarations: [{ name: 'saldo' }] }],
      toolConfig: { functionCallingConfig: { mode: 'NONE' } },
    })
    expect(corpo.tools).toBeUndefined()
  })

  it('imagem vira data URI; áudio comprimido é declarado mp3 e wav fica wav', () => {
    const corpo = paraMuse({
      contents: [{ role: 'user', parts: [
        { text: 'leia' },
        { inline_data: { mime_type: 'image/jpeg', data: 'AAA' } },
        { inline_data: { mime_type: 'audio/webm;codecs=opus', data: 'BBB' } },
        { inlineData: { mimeType: 'audio/wav', data: 'CCC' } },
      ] }],
    })
    expect((corpo.messages as { content: unknown }[])[0].content).toEqual([
      { type: 'text', text: 'leia' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      { type: 'input_audio', input_audio: { data: 'BBB', format: 'mp3' } },
      { type: 'input_audio', input_audio: { data: 'CCC', format: 'wav' } },
    ])
  })

  it('JSON: com esquema usa json_schema, sem esquema usa json_object', () => {
    const base = { contents: [{ role: 'user', parts: [{ text: 'x' }] }] }
    expect(paraMuse({ ...base, generationConfig: { responseMimeType: 'application/json' } }).response_format)
      .toEqual({ type: 'json_object' })
    expect(paraMuse({ ...base, generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { q: { type: 'NUMBER', nullable: true } } } } }).response_format)
      .toEqual({ type: 'json_schema', json_schema: { name: 'resposta', schema: { type: 'object', properties: { q: { type: ['number', 'null'] } } } } })
  })
})

describe('esquemaJson', () => {
  it('mantém enum e required, só normaliza type e nullable', () => {
    expect(esquemaJson({ type: 'STRING', enum: ['alta', 'baixa'] })).toEqual({ type: 'string', enum: ['alta', 'baixa'] })
    expect(esquemaJson({ type: 'ARRAY', items: { type: 'STRING' } })).toEqual({ type: 'array', items: { type: 'string' } })
  })
})

describe('deMuse', () => {
  it('texto vira parte de texto', () => {
    expect(deMuse({ choices: [{ message: { content: 'oi' }, finish_reason: 'stop' }] }))
      .toEqual({ candidates: [{ content: { role: 'model', parts: [{ text: 'oi' }] }, finishReason: 'STOP' }] })
  })

  it('tool_calls viram functionCall com args já interpretados', () => {
    const r = deMuse({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'saldo', arguments: '{"nome":"blackout"}' } }] }, finish_reason: 'tool_calls' }] })
    expect(r?.candidates[0].content.parts).toEqual([{ functionCall: { name: 'saldo', args: { nome: 'blackout' } } }])
  })

  it('resposta sem conteúdo nem chamada é null', () => {
    expect(deMuse({ choices: [{ message: { content: null } }] })).toBeNull()
    expect(deMuse(null)).toBeNull()
  })
})

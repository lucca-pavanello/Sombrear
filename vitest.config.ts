import { defineConfig } from 'vitest/config'
import path from 'path'

// Só os testes do projeto — sem o config ele varria dist/, .claude/ e afins.
// O alias precisa estar aqui: este arquivo NÃO herda o resolve do vite.config.ts, e sem
// ele nenhum teste consegue importar por '@/...' como o resto do código faz.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // os testes de migration sobem um Postgres em WebAssembly no beforeEach; com a suíte inteira
    // em paralelo o primeiro arranque passa dos 10 s padrão e o teste caía por tempo, não por erro
    hookTimeout: 30_000,
    // o fuso da loja, que é o do navegador de quem usa o dash. Em UTC o bug da venda
    // do dia 1º caindo no mês anterior (data sem hora lida como meia-noite UTC) não
    // aparece: foi assim que ele passou despercebido.
    env: { TZ: 'America/Sao_Paulo' },
  },
})

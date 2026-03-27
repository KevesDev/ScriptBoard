import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import tailwindcss from '@tailwindcss/vite'
import obfuscator from 'vite-plugin-javascript-obfuscator'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const prod = mode === 'production'

  return {
    resolve: {
      alias: {
        '@main': path.resolve(__dirname, 'electron'),
        '@renderer': path.resolve(__dirname, 'src'),
        '@common': path.resolve(__dirname, 'common'),
      },
    },
    plugins: [
      react(),
      tailwindcss(),
      electron([
        {
          entry: 'electron/main.ts',
          vite: {
            build: {
              rollupOptions: {
                external: ['adm-zip', 'ffmpeg-static'],
              },
            },
            plugins: [
              prod
                ? obfuscator({
                    include: ['electron/**/*.ts', 'common/**/*.ts'],
                    exclude: [/node_modules/],
                    apply: 'build',
                    options: {
                      compact: true,
                      controlFlowFlattening: true,
                      deadCodeInjection: true,
                      deadCodeInjectionThreshold: 0.1,
                      stringArray: true,
                      stringArrayEncoding: ['base64'],
                      disableConsoleOutput: true,
                      identifierNamesGenerator: 'hexadecimal',
                    },
                  })
                : null,
            ].filter(Boolean),
          },
        },
        {
          entry: 'electron/preload.ts',
          onstart(options) {
            options.reload()
          },
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                },
              },
            },
            plugins: [
              prod
                ? obfuscator({
                    include: ['electron/preload.ts'],
                    exclude: [/node_modules/],
                    apply: 'build',
                    options: {
                      compact: true,
                      stringArray: true,
                      stringArrayEncoding: ['base64'],
                      disableConsoleOutput: true,
                    },
                  })
                : null,
            ].filter(Boolean),
          },
        },
      ]),
      renderer(),
      prod
        ? obfuscator({
            include: ['src/**/*.ts', 'src/**/*.tsx', 'common/**/*.ts'],
            exclude: [/node_modules/],
            apply: 'build',
            options: {
              compact: true,
              controlFlowFlattening: true,
              deadCodeInjection: false,
              stringArray: true,
              stringArrayEncoding: ['base64'],
              identifierNamesGenerator: 'hexadecimal',
            },
          })
        : null,
    ].filter(Boolean) as any,
  }
})

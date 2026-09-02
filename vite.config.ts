import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    /* 8080 continua sendo o padrão do `npm run dev` — é a porta que todo mundo
       tem no navegador. `PORT` só entra quando alguém a define, que é o caso de
       uma segunda instância subindo ao lado da que já está rodando: sem isso ela
       morre com "porta em uso" em vez de escolher outra. */
    port: Number(process.env.PORT) || 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':   ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-charts':  ['recharts'],
          'vendor-dnd':     ['@dnd-kit/core', '@dnd-kit/utilities'],
          'vendor-ui':      [
            '@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-select',
            '@radix-ui/react-tabs', '@radix-ui/react-toast', '@radix-ui/react-tooltip',
            '@radix-ui/react-checkbox', '@radix-ui/react-separator', '@radix-ui/react-label',
            '@radix-ui/react-slot', 'class-variance-authority', 'clsx', 'tailwind-merge',
          ],
          'vendor-dates':   ['date-fns'],
        },
      },
    },
  },
}));

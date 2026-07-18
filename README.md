# custos

Terminal-native, local-first developer security sidekick. See [AGENTS.MD](./AGENTS.MD) for full product and architecture context.

## Installation

```bash
npm install
cp .env.example .env
```

## Development

```bash
npm run dev -- --help      # run the CLI via tsx
npm run build              # compile TypeScript to dist/
npm start                   # run the compiled CLI
npm run lint                # eslint
npm run typecheck           # tsc --noEmit
npm test                    # vitest
```

To try commands locally:

```bash
npm run dev -- init
npm run dev -- scan
npm run dev -- audit
npm run dev -- doctor
```

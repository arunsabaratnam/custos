# custos

Terminal-native, local-first developer security sidekick. See [AGENTS.MD](./AGENTS.MD) for full product and architecture context.

## Installation

For local development, install dependencies, build the CLI, and link the
`custos` command onto your machine:

```bash
npm install
npm run build
npm link
cp .env.example .env
```

Then verify the global command:

```bash
custos
```

Initialize Custos inside any Git repository:

```bash
custos init
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
npm run dev
npm run dev -- init
npm run dev -- scan
npm run dev -- audit
npm run dev -- doctor
```

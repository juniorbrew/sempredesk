import { NextResponse } from 'next/server';

/** Não é reescrito pelo proxy `/api/v1/*` — use para confirmar que o Next correto está na porta. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    app: 'sempredesk-frontend',
    router: 'app',
    time: new Date().toISOString(),
  });
}

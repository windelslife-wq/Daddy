/**
 * Real transport implementations for the CLI live verifiers.
 * Shared by scripts/setup.js and scripts/activate.mjs so both use the same
 * SMTP handshake and PostgreSQL connection test as the running app.
 */
export async function cliVerifierImpls() {
  const impls = {};
  try {
    const nodemailer = (await import('nodemailer')).default;
    impls.smtpVerifyImpl = async (url, timeoutMs) => {
      const transport = nodemailer.createTransport(url);
      let timer;
      try {
        await Promise.race([
          transport.verify(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SMTP verification timed out')), timeoutMs); }),
        ]);
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error.message };
      } finally {
        clearTimeout(timer);
        try { transport.close(); } catch { /* already closed */ }
      }
    };
  } catch { /* nodemailer unavailable; verifier reports unsupported */ }
  try {
    const pgModule = await import('pg');
    const Client = pgModule.Client || pgModule.default?.Client;
    if (Client) {
      impls.pgCheckImpl = async (url, timeoutMs) => {
        const client = new Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
        try {
          await client.connect();
          await client.query('SELECT 1');
          return { ok: true };
        } catch (error) {
          return { ok: false, message: error.message };
        } finally {
          try { await client.end(); } catch { /* connection never opened */ }
        }
      };
    }
  } catch { /* pg unavailable; verifier reports unsupported */ }
  return impls;
}

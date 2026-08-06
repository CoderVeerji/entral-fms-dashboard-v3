// Gmail API (gmail.send scope) — sends real email to ANY recipient without needing a verified
// sending domain, unlike Resend's free tier (which restricts unverified accounts to sending only
// to the address the account itself was signed up with — see the auth.ts comment on
// GENERIC_RESET_MESSAGE for why that surfaced as "reset says it worked but no email arrives").
// Gmail's own domain is already verified by Google, so any Gmail (or Workspace) account can send
// to anyone the moment it authorizes this app once — free, no card, no DNS access needed.
//
// One-time setup (see /README.md "Manual setup steps"): create an OAuth 2.0 Client ID in Google
// Cloud Console, authorize it for the `gmail.send` scope against the sending Gmail account via
// Google's OAuth Playground (developers.google.com/oauthplayground), and set GMAIL_CLIENT_ID /
// GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN / GMAIL_SENDER_EMAIL as Worker secrets. Workers are
// stateless between requests, so every send here exchanges the long-lived refresh token for a
// short-lived access token first — there is nothing to cache across invocations.
export interface SendEmailResult {
  ok: boolean;
  error?: string;
}

export interface GmailCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  senderEmail: string;
}

async function getGmailAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json<{ access_token: string }>();
  return data.access_token;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildRawMessage(from: string, to: string, subject: string, html: string, text: string): string {
  const boundary = 'boundary_' + crypto.randomUUID().replace(/-/g, '');
  const encodedSubject = `=?UTF-8?B?${toBase64(new TextEncoder().encode(subject))}?=`;
  const message =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${encodedSubject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${text}\r\n\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset="UTF-8"\r\n\r\n${html}\r\n\r\n` +
    `--${boundary}--`;
  return toBase64Url(new TextEncoder().encode(message));
}

export async function sendEmail(
  creds: GmailCreds, to: string, subject: string, html: string, text: string,
): Promise<SendEmailResult> {
  try {
    const accessToken = await getGmailAccessToken(creds.clientId, creds.clientSecret, creds.refreshToken);
    const raw = buildRawMessage(creds.senderEmail, to, subject, html, text);
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    if (res.ok) return { ok: true };
    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function passwordResetEmailHtml(username: string, tempPassword: string, appUrl: string): string {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#F4F7FB;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 6px 24px rgba(7,26,43,.08);">
      <h2 style="color:#071A2B;margin-top:0;">Password Reset</h2>
      <p>Hi <b>${escapeHtml(username)}</b>, a password reset was requested for your Central FMS Dashboard account.</p>
      <div style="background:linear-gradient(135deg,#1677FF,#17C3B2);border-radius:12px;padding:18px;text-align:center;margin:20px 0;">
        <div style="color:rgba(255,255,255,.85);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Temporary Password</div>
        <div style="color:#fff;font-size:22px;font-weight:800;font-family:monospace;">${escapeHtml(tempPassword)}</div>
      </div>
      <p>You'll be asked to set a new password the next time you sign in.</p>
      <p><a href="${appUrl}" style="display:inline-block;background:#1677FF;color:#fff;text-decoration:none;padding:11px 24px;border-radius:30px;font-weight:700;">Open Dashboard</a></p>
      <p style="color:#5A6B84;font-size:12px;margin-top:24px;">If you did not request this, contact your administrator immediately.</p>
    </div>
  </body></html>`;
}

export function actionReminderEmailHtml(fmsName: string, recordDisplay: string, stageName: string, planTime: string, delayHuman: string): string {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#F4F7FB;padding:24px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 6px 24px rgba(7,26,43,.08);">
      <h2 style="color:#071A2B;margin-top:0;">Action Reminder</h2>
      <p>A stage is waiting on some attention:</p>
      <div style="background:#F8FAFD;border:1px solid #E4E9F2;border-radius:12px;padding:16px 18px;margin:16px 0;font-size:13.5px;">
        <div><b>FMS:</b> ${escapeHtml(fmsName)}</div>
        <div><b>Record:</b> ${escapeHtml(recordDisplay)}</div>
        <div><b>Stage:</b> ${escapeHtml(stageName)}</div>
        <div><b>Plan Time:</b> ${escapeHtml(planTime)}</div>
        <div><b>Delay:</b> ${escapeHtml(delayHuman)}</div>
      </div>
      <p style="color:#5A6B84;font-size:12px;margin-top:24px;">This is an automated reminder from Central FMS Dashboard.</p>
    </div>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

import { Resend } from 'resend';

export class EmailService {
  private readonly resend: Resend;
  private readonly fromAddress = 'noreply@translate-voice.app';

  constructor(apiKey: string) {
    this.resend = new Resend(apiKey);
  }

  async sendMagicLink(email: string, rawToken: string, baseUrl: string): Promise<void> {
    const url = `${baseUrl}/auth/magic-link/verify?token=${rawToken}`;

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: email,
      subject: 'Your sign-in link for Translate Voice',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>Sign in to Translate Voice</h2>
          <p>Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
          <a href="${url}"
             style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
            Sign in
          </a>
          <p style="color:#6b7280;font-size:12px;margin-top:24px">
            If you didn't request this, you can safely ignore this email.
          </p>
        </div>
      `,
      text: `Sign in to Translate Voice\n\nClick this link to sign in (expires in 15 minutes):\n${url}\n\nIf you didn't request this, ignore this email.`,
    });

    if (error) {
      const err = Object.assign(new Error(`Email send failed: ${error.message}`), {
        statusCode: 503,
      });
      throw err;
    }
  }
}

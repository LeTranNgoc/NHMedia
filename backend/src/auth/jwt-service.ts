import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export interface JwtClaims {
  userId: string;
  email: string;
}

type JwtClaimsPayload = JwtClaims & JWTPayload;

export class JwtService {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    this.secret = new TextEncoder().encode(secret);
  }

  async sign(claims: JwtClaims, expirationTime: string = '7d'): Promise<string> {
    return new SignJWT(claims as JwtClaimsPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(expirationTime)
      .sign(this.secret);
  }

  async verify(token: string): Promise<JwtClaims> {
    const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
    return {
      userId: payload['userId'] as string,
      email: payload['email'] as string,
    };
  }

  /** Verify and return the full raw payload (for state JWTs with custom fields). */
  async verifyRaw(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, this.secret, { algorithms: ['HS256'] });
    return payload;
  }
}

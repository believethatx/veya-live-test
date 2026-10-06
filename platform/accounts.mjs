import { randomBytes, createHash, createHmac } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

export const accountConfig = () => ({
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  facebook: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && /^v\d+\.\d+$/.test(process.env.FACEBOOK_API_VERSION || '')),
  email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
});
const random = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
export function createOAuthFlow() {
  const pending = new Map();
  return {
    start(provider, origin, userId = null) {
      if (!accountConfig()[provider]) throw Error('This sign-in option is not connected yet');
      for (const [key, entry] of pending) if (entry.expires < Date.now()) pending.delete(key);
      if (pending.size >= 1000) throw Error('Please try again shortly');
      const state = random(), binding = random(), verifier = random(), nonce = random();
      const redirect = `${origin}/auth/${provider}/callback`;
      pending.set(hash(state), { provider, binding: hash(binding), verifier, nonce, redirect, userId, expires: Date.now() + 600_000 });
      let url;
      if (provider === 'google') {
        url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
      } else {
        url = new URL(`https://www.facebook.com/${process.env.FACEBOOK_API_VERSION}/dialog/oauth`);
        url.search = new URLSearchParams({client_id:process.env.FACEBOOK_APP_ID,redirect_uri:redirect,response_type:'code',scope:'email,public_profile',state});
      }
      return {url:url.href,binding};
    },
    async finish(provider, state, binding, code, currentUserId = null) {
      const key = hash(state || ''), entry = pending.get(key); pending.delete(key);
      if (!entry || entry.expires < Date.now() || entry.provider !== provider || entry.binding !== hash(binding || '') || entry.userId !== currentUserId || !code) throw Error('Sign-in expired. Please start again.');
      let profile, subject;
      if (provider === 'google') {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,entry.redirect);
        const {tokens} = await client.getToken({code,codeVerifier:entry.verifier});
        const ticket = await client.verifyIdToken({idToken:tokens.id_token,audience:process.env.GOOGLE_CLIENT_ID});
        profile = ticket.getPayload();
        if (profile?.nonce !== entry.nonce || !profile?.sub) throw Error('Invalid sign-in response');
        subject = profile.sub;
      } else {
        const base = `https://graph.facebook.com/${process.env.FACEBOOK_API_VERSION}`;
        const response = await fetch(`${base}/oauth/access_token`, {method:'POST',body:new URLSearchParams({client_id:process.env.FACEBOOK_APP_ID,client_secret:process.env.FACEBOOK_APP_SECRET,redirect_uri:entry.redirect,code}),signal:AbortSignal.timeout(10000)});
        const token = await response.json();
        if (!response.ok || !token.access_token) throw Error('Facebook sign-in failed');
        const url = new URL(`${base}/me`);
        url.search = new URLSearchParams({fields:'id,name,email',appsecret_proof:createHmac('sha256',process.env.FACEBOOK_APP_SECRET).update(token.access_token).digest('hex')});
        const userResponse = await fetch(url,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
        profile = await userResponse.json();
        if (!userResponse.ok || typeof profile.id !== 'string') throw Error('Facebook sign-in failed');
        subject = profile.id;
      }
      return {subject,profile};
    },
  };
}
export async function sendAccountEmail(email, purpose, token, origin) {
  if (!accountConfig().email) throw Error('Email delivery is not connected yet');
  const link = `${origin}/#${new URLSearchParams({action:purpose,token})}`;
  const action = purpose === 'verify' ? 'Verify your email' : 'Reset your password';
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:`Veya: ${action}`,text:`${action} using this one-use link:\n${link}\n\nIf you did not request this, ignore this email.`}),signal:AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error('Email delivery failed. Please try again later.');
}

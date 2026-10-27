import crypto from 'node:crypto';
import { db, json } from '../db.js';
import { config } from '../config.js';
import { AppError, badRequest } from '../errors.js';
import { randomToken } from '../security.js';
import { graphRequest } from '../publishers/graph.js';
import { oauth1Fetch } from './oauth1.js';
import {
  oauthCallbackUrl, createState, consumeState, upsertConnectedAccount,
  oauthSuccess, oauthFetchJson,
} from './helpers.js';

const META_SCOPES = [
  'public_profile', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
  'instagram_basic', 'instagram_content_publish', 'business_management',
].join(',');
const GOOGLE_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
].join(' ');

function requireMetaConfig() {
  if (!config.oauth.metaAppId || !config.oauth.metaAppSecret) throw new AppError(503, 'integration_not_configured', 'META_APP_ID and META_APP_SECRET are not configured. Add them to the server environment and whitelist the callback URL in the Meta app.');
}
function requireGoogleConfig() {
  if (!config.oauth.googleClientId || !config.oauth.googleClientSecret) throw new AppError(503, 'integration_not_configured', 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured. Add them to the server environment and whitelist the callback URL in Google Cloud.');
}

export async function startFacebook(req, res) {
  requireMetaConfig();
  const state = await createState('facebook', req.user.id, { requestedScopes: META_SCOPES });
  const url = new URL(`https://www.facebook.com/${config.oauth.metaGraphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.oauth.metaAppId);
  url.searchParams.set('redirect_uri', oauthCallbackUrl('facebook'));
  url.searchParams.set('state', state);
  url.searchParams.set('scope', META_SCOPES);
  url.searchParams.set('response_type', 'code');
  res.redirect(url.toString());
}

export async function handleFacebook(req, res) {
  requireMetaConfig();
  const stateRow = await consumeState('facebook', req.query.state);
  if (req.query.error) throw new AppError(400, 'oauth_denied', req.query.error_description || req.query.error || 'Meta authorization was denied.');
  if (!req.query.code) throw badRequest('Meta did not return an authorization code.');
  const shortToken = await graphRequest('/oauth/access_token', {
    method: 'GET',
    params: {
      client_id: config.oauth.metaAppId,
      client_secret: config.oauth.metaAppSecret,
      redirect_uri: oauthCallbackUrl('facebook'),
      code: String(req.query.code),
    },
  });
  if (!shortToken.access_token) throw new AppError(502, 'oauth_provider_error', 'Meta did not return a short-lived access token.');
  const longToken = await graphRequest('/oauth/access_token', {
    method: 'GET',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: config.oauth.metaAppId,
      client_secret: config.oauth.metaAppSecret,
      fb_exchange_token: shortToken.access_token,
    },
  });
  const userToken = longToken.access_token || shortToken.access_token;
  const expiresAt = longToken.expires_in ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString() : null;
  const pages = await graphRequest('/me/accounts', {
    method: 'GET', accessToken: userToken,
    params: { fields: 'id,name,access_token,perms,instagram_business_account{id,username,name}', limit: 100 },
  });
  const pageList = (pages.data || []).filter((page) => page.access_token);
  if (!pageList.length) throw new AppError(400, 'no_facebook_pages', 'No manageable Facebook Pages were returned. Connect a Page where you have CREATE_CONTENT permission, then try again.');
  let count = 0;
  for (const page of pageList) {
    const credentials = {
      userAccessToken: userToken,
      pageAccessToken: page.access_token,
      accessToken: page.access_token,
      expiresAt,
      appId: config.oauth.metaAppId,
    };
    await upsertConnectedAccount({
      userId: stateRow.user_id,
      platform: 'facebook',
      externalId: page.id,
      displayName: page.name || `Facebook Page ${page.id}`,
      handle: null,
      credentials,
      scopes: META_SCOPES.split(','),
      permissions: page.perms || [],
      tokenExpiresAt: expiresAt,
      metadata: { metaAppId: config.oauth.metaAppId, graphVersion: config.oauth.metaGraphVersion },
    });
    count += 1;
    const ig = page.instagram_business_account;
    if (ig?.id) {
      await upsertConnectedAccount({
        userId: stateRow.user_id,
        platform: 'instagram',
        externalId: ig.id,
        displayName: ig.name || ig.username || `Instagram ${ig.id}`,
        handle: ig.username ? `@${ig.username}` : null,
        credentials,
        scopes: META_SCOPES.split(','),
        permissions: page.perms || [],
        tokenExpiresAt: expiresAt,
        metadata: { linkedFacebookPageId: page.id, graphVersion: config.oauth.metaGraphVersion },
      });
      count += 1;
    }
  }
  oauthSuccess(res, 'facebook', `Connected ${count} Meta page${count === 1 ? '' : 's'}. Instagram accounts appear when linked to a selected Page.`);
}

export async function startGoogle(req, res) {
  requireGoogleConfig();
  const state = await createState('google', req.user.id, { requestedScopes: GOOGLE_SCOPES });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.oauth.googleClientId);
  url.searchParams.set('redirect_uri', oauthCallbackUrl('google'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
}

export async function handleGoogle(req, res) {
  requireGoogleConfig();
  const stateRow = await consumeState('google', req.query.state);
  if (req.query.error) throw new AppError(400, 'oauth_denied', req.query.error_description || req.query.error || 'Google authorization was denied.');
  if (!req.query.code) throw badRequest('Google did not return an authorization code.');
  const form = new URLSearchParams({
    code: String(req.query.code),
    client_id: config.oauth.googleClientId,
    client_secret: config.oauth.googleClientSecret,
    redirect_uri: oauthCallbackUrl('google'),
    grant_type: 'authorization_code',
  });
  const token = await oauthFetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
  });
  if (!token.refresh_token) throw new AppError(400, 'missing_refresh_token', 'Google did not return a refresh token. Revoke this app’s access in your Google account, then reconnect with consent.');
  const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
  const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelsUrl.searchParams.set('part', 'snippet');
  channelsUrl.searchParams.set('mine', 'true');
  channelsUrl.searchParams.set('maxResults', '50');
  const channels = await oauthFetchJson(channelsUrl, { method: 'GET', headers: { authorization: `Bearer ${token.access_token}` } });
  const items = channels.items || [];
  if (!items.length) throw new AppError(400, 'no_youtube_channels', 'No YouTube channels were found for this Google account. Create a channel and reconnect.');
  for (const channel of items) {
    await upsertConnectedAccount({
      userId: stateRow.user_id,
      platform: 'youtube',
      externalId: channel.id,
      displayName: channel.snippet?.title || `YouTube ${channel.id}`,
      handle: channel.snippet?.customUrl || null,
      avatarUrl: channel.snippet?.thumbnails?.default?.url || null,
      credentials: { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt },
      scopes: String(token.scope || GOOGLE_SCOPES).split(/\s+/),
      permissions: ['youtube.upload', 'youtube.readonly', 'youtube.force-ssl'],
      tokenExpiresAt: expiresAt,
      metadata: { tokenType: token.token_type || 'Bearer' },
    });
  }
  oauthSuccess(res, 'youtube', `Connected ${items.length} YouTube channel${items.length === 1 ? '' : 's'}.`);
}

export async function startX(req, res) {
  const state = await createState('x', req.user.id, {});
  const callback = oauthCallbackUrl('x', { state });
  const form = new URLSearchParams({ oauth_callback: callback });
  const requestToken = await oauth1Fetch('https://api.x.com/oauth/request_token', {
    method: 'POST',
    data: { oauth_callback: callback },
    body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    formResponse: true,
  });
  if (requestToken.oauth_callback_confirmed !== 'true' || !requestToken.oauth_token) {
    throw new AppError(502, 'oauth_provider_error', 'X did not confirm the OAuth 1.0a request token. Check the consumer keys and callback URL.');
  }
  await db('oauth_states').where({ state, provider: 'x' }).update({
    metadata: json({ requestToken: requestToken.oauth_token, requestTokenSecret: requestToken.oauth_token_secret, callback }),
  });
  const authorize = new URL('https://api.x.com/oauth/authorize');
  authorize.searchParams.set('oauth_token', requestToken.oauth_token);
  authorize.searchParams.set('state', state);
  res.redirect(authorize.toString());
}

export async function handleX(req, res) {
  const stateRow = await consumeState('x', req.query.state);
  const metadata = stateRow.metadataObject || {};
  if (!req.query.oauth_verifier || !req.query.oauth_token) throw badRequest('X did not return an OAuth verifier.');
  if (req.query.oauth_token !== metadata.requestToken) throw badRequest('The X OAuth token does not match the saved request token.');
  const form = new URLSearchParams({ oauth_verifier: String(req.query.oauth_verifier) });
  const access = await oauth1Fetch('https://api.x.com/oauth/access_token', {
    method: 'POST',
    token: { key: metadata.requestToken, secret: metadata.requestTokenSecret },
    data: { oauth_verifier: String(req.query.oauth_verifier) },
    body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    formResponse: true,
  });
  if (!access.oauth_token || !access.oauth_token_secret) throw new AppError(502, 'oauth_provider_error', 'X did not return user access tokens.');
  const tokens = { key: access.oauth_token, secret: access.oauth_token_secret };
  const profileUrl = new URL('https://api.x.com/2/users/me');
  profileUrl.searchParams.set('user.fields', 'id,username,name,profile_image_url');
  let profile = null;
  try {
    profile = await oauth1Fetch(profileUrl, { method: 'GET', token: tokens, data: Object.fromEntries(profileUrl.searchParams), formResponse: false });
  } catch {
    // Some X API tiers do not allow /users/me. request-token response still includes the user identity.
  }
  const externalId = profile?.data?.id || access.user_id;
  const screenName = profile?.data?.username || access.screen_name;
  if (!externalId) throw new AppError(502, 'oauth_provider_error', 'X did not return a user ID.');
  await upsertConnectedAccount({
    userId: stateRow.user_id,
    platform: 'x',
    externalId,
    displayName: profile?.data?.name || (screenName ? `@${screenName}` : `X user ${externalId}`),
    handle: screenName ? `@${screenName}` : null,
    avatarUrl: profile?.data?.profile_image_url || null,
    credentials: { oauthToken: access.oauth_token, oauthTokenSecret: access.oauth_token_secret, userId: externalId, screenName },
    scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'],
    permissions: ['publish', 'metrics'],
    metadata: { oauthVersion: '1.0a', profileAvailable: Boolean(profile?.data?.id) },
  });
  oauthSuccess(res, 'x', 'Connected X account with OAuth 1.0a user context.');
}

export async function startSandbox(req, res) {
  const state = await createState('sandbox', req.user.id, { purpose: 'local-http-test' });
  res.redirect(`/oauth/sandbox?state=${encodeURIComponent(state)}`);
}

export async function authorizeSandbox(req, res) {
  const state = String(req.body?.state || '');
  const displayName = String(req.body?.displayName || '').trim().slice(0, 120) || 'Sandbox Channel';
  const original = await consumeState('sandbox', state);
  const accessToken = randomToken(24);
  const code = await createState('sandbox_code', original.user_id, { displayName, accessToken, originalStateId: original.id });
  res.json({ redirectUrl: `/api/oauth/sandbox/callback?code=${encodeURIComponent(code)}` });
}

export async function handleSandbox(req, res) {
  const row = await consumeState('sandbox_code', req.query.code);
  const metadata = row.metadataObject || {};
  const externalId = `sandbox-${crypto.randomUUID().slice(0, 8)}`;
  await upsertConnectedAccount({
    userId: row.user_id,
    platform: 'sandbox',
    externalId,
    displayName: metadata.displayName || 'Sandbox Channel',
    handle: `@${externalId}`,
    credentials: { accessToken: metadata.accessToken || randomToken(24), mode: 'local-http' },
    scopes: ['sandbox.publish', 'sandbox.metrics'],
    permissions: ['publish', 'metrics'],
    metadata: { note: 'Local HTTP test publisher. This is not an external social network.' },
  });
  oauthSuccess(res, 'sandbox', 'Connected a local sandbox channel. Publishing will use the built-in HTTP endpoint.');
}

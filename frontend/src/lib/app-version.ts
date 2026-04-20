const appVersion = (process.env.NEXT_PUBLIC_APP_VERSION || 'dev-local').trim();
const appGitSha = (process.env.NEXT_PUBLIC_APP_GIT_SHA || '').trim();

export function getAppVersionLabel() {
  if (!appGitSha) {
    return appVersion;
  }

  return `${appVersion} (${appGitSha})`;
}

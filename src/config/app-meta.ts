import packageJson from '../../package.json';

export const APP_NAME = '无界 AI';
export const APP_DEVELOPER = 'Mr.joker';
export const APP_RELEASE_CHANNEL = 'Beta';
export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `${APP_VERSION} ${APP_RELEASE_CHANNEL}`;
export const APP_FULL_VERSION_LABEL = `版本号：${APP_VERSION_LABEL} | Developer：${APP_DEVELOPER}`;

// Password rules for company accounts, shared by the API and the browser
// (lib/console-users.ts imports the database driver, so the UI cannot).
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 256;

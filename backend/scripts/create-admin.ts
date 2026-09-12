import readline from 'readline';
import prisma from '../src/models/prisma.js';
import { config, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../src/config/index.js';
import { userService } from '../src/services/user.service.js';

// Phase 20: the one sanctioned way to provision an additional ADMIN
// account. There is no HTTP endpoint anywhere that can create an admin -
// public registration (POST /auth/register) always rejects the role
// regardless of what a caller sends (see PUBLIC_REGISTRATION_ROLES in
// auth.service.ts) - so besides direct database access, this script and
// prisma/seed.ts's fixed admin@foodbridge.com are the only ways an ADMIN
// account comes to exist. Unlike seed.ts, this is meant to be run against
// a real production database when you actually need a second admin - it
// takes real credentials of your choosing, never a hardcoded password,
// and refuses to overwrite an existing account.
//
// Usage:
//   Scripted/CI (no interactive prompts):
//     ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" ADMIN_PASSWORD=... \
//       npm run admin:create
//
//   Interactive (prompts for each value; password input is masked, not
//   echoed to the terminal):
//     npm run admin:create
//
// The password is never logged or printed anywhere by this script, in
// either mode.

function promptVisible(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// No third-party prompt library - this is the standard dependency-free
// pattern for masked stdin input in Node. Falls back to plain (unmasked)
// line input if stdin isn't a real TTY (e.g. piped input in some CI
// setups) - `raw mode` only exists on an interactive terminal;
// ADMIN_PASSWORD is the recommended non-interactive path specifically to
// avoid relying on this fallback for anything sensitive.
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;

    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (char: string) => {
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl-D
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          break;
        case '\u0003': // Ctrl-C
          process.stdout.write('\n');
          process.exit(1);
          break;
        case '\u007f': // backspace
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          break;
        default:
          value += char;
          process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const email = (process.env.ADMIN_EMAIL?.trim()) || (await promptVisible('Admin email: '));
  const name = (process.env.ADMIN_NAME?.trim()) || (await promptVisible('Admin name: '));
  const passwordFromEnv = process.env.ADMIN_PASSWORD;
  const password = passwordFromEnv || (await promptHidden('Admin password (input hidden): '));

  if (!email || !email.includes('@')) {
    console.error('A valid email is required.');
    process.exit(1);
  }
  if (!name) {
    console.error('A name is required.');
    process.exit(1);
  }
  if (!password || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    console.error(
      `A password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters is required ` +
        '(the same policy used everywhere else - see PASSWORD_MIN_LENGTH/PASSWORD_MAX_LENGTH in src/config/index.ts).'
    );
    process.exit(1);
  }

  // Extra confirmation step, production only, interactive password entry
  // only (a scripted ADMIN_PASSWORD invocation is already an explicit,
  // deliberate act - this is specifically for a human at a keyboard about
  // to create a production admin account).
  if (config.nodeEnv === 'production' && !passwordFromEnv) {
    console.log('\nYou are about to create an ADMIN account in a PRODUCTION environment.');
    const confirmation = await promptVisible(`Type the email address again to confirm (${email}): `);
    if (confirmation !== email) {
      console.error('Confirmation did not match - aborting. No account was created.');
      process.exit(1);
    }
  }

  try {
    const admin = await userService.createAdmin({ email, name, password });
    console.log(`\nCreated ADMIN account: ${admin.email} (id: ${admin.id})`);
    console.log('The password was not logged anywhere and is not recoverable - store it securely.');
  } catch (error) {
    console.error('Failed to create admin account:', error instanceof Error ? error.message : error);
    console.error('No changes were made.');
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('Unexpected error creating admin account:', error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import readline from 'node:readline';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const execAsync = promisify(exec);

function question(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function getSetupMode(): Promise<'local' | 'production'> {
  console.log('Step 1: Setup Mode');
  const answer = await question(
    'Is this setup for Local Development (L) or Production Deployment (P)? (L/P): '
  );
  return answer.toLowerCase() === 'p' ? 'production' : 'local';
}

async function checkStripeCLI(mode: 'local' | 'production') {
  if (mode === 'production') {
    console.log('Skipping Stripe CLI check for Production environment.');
    return;
  }

  console.log('Step 2: Checking Stripe CLI status...');
  try {
    await execAsync('stripe --version');
    console.log('Stripe CLI is installed.');

    try {
      await execAsync('stripe config --list');
      console.log('Stripe CLI is authenticated.');
    } catch (error) {
      console.log('Stripe CLI is not authenticated.');
      console.log('Please run: stripe login');
      const answer = await question(
        'Have you completed the authentication? (y/n): '
      );
      if (answer.toLowerCase() !== 'y') {
        console.log(
          'Please authenticate with Stripe CLI and run this script again.'
        );
        process.exit(1);
      }

      try {
        await execAsync('stripe config --list');
        console.log('Stripe CLI authentication confirmed.');
      } catch (error) {
        console.error(
          'Failed to verify Stripe CLI authentication. Please try again.'
        );
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(
      'Stripe CLI is not installed. Please install it and try again.'
    );
    console.log('To install Stripe CLI, follow these steps:');
    console.log('1. Visit: https://docs.stripe.com/stripe-cli');
    console.log(
      '2. Download and install the Stripe CLI for your operating system'
    );
    console.log('3. After installation, run: stripe login');
    console.log(
      'After installation and authentication, please run this setup script again.'
    );
    process.exit(1);
  }
}

async function getPostgresURL(): Promise<string> {
  console.log('Step 3: Database Setup');
  
  const dbChoice = await question(
    'Do you want to use a local Docker Postgres (L) or a remote Postgres URL (R)? (L/R): '
  );

  if (dbChoice.toLowerCase() === 'l') {
    console.log('Setting up local Postgres with Docker...');
    await setupLocalPostgres();
    throw new Error('POSTGRES_URL or DATABASE_URL is required');
  } else {
    console.log(
      'You can find Postgres databases at: https://vercel.com/marketplace?category=databases'
    );
    return await question('Enter your Connection String (Postgres URL): ');
  }
}

async function setupLocalPostgres() {
  console.log('Checking for Docker...');
  try {
    await execAsync('docker --version');
    console.log('Docker is installed.');
  } catch (error) {
    console.error(
      'Docker is not installed. Please install Docker and try again.'
    );
    console.log(
      'To install Docker, visit: https://docs.docker.com/get-docker/'
    );
    process.exit(1);
  }

  console.log('Creating docker-compose.yml...');
  const dockerComposeContent = `
services:
  postgres:
    image: postgres:16.4-alpine
    container_name: next_saas_starter_postgres
    environment:
      POSTGRES_DB: postgres
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "54322:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
`;

  await fs.writeFile(
    path.join(process.cwd(), 'docker-compose.yml'),
    dockerComposeContent
  );
  console.log('docker-compose.yml created.');

  console.log('Starting Docker container...');
  try {
    await execAsync('docker compose up -d');
    console.log('Docker container started successfully.');
  } catch (error) {
    console.error(
      'Failed to start Docker container. Please check your Docker installation.'
    );
    process.exit(1);
  }
}

async function getStripeSecretKey(): Promise<string> {
  console.log('Step 4: Stripe Configuration');
  console.log(
    'Find your Secret Key at: https://dashboard.stripe.com/test/apikeys'
  );
  return await question('Enter your Stripe Secret Key: ');
}

async function getStripeWebhookSecret(mode: 'local' | 'production'): Promise<string> {
  console.log('Step 5: Stripe Webhook Setup');

  if (mode === 'production') {
    console.log('For production, you need to configure a webhook in the Stripe Dashboard.');
    console.log('1. Go to: https://dashboard.stripe.com/webhooks');
    console.log('2. Click "Add endpoint"');
    console.log('3. Enter your domain URL followed by /api/webhook/stripe');
    console.log('4. Select the events you want to listen to.');
    console.log('5. Reveal the "Signing secret" (starts with whsec_).');
    
    const secret = await question('Enter your Production Stripe Webhook Secret: ');
    if (!secret.startsWith('whsec_')) {
      console.warn('Warning: The secret typically starts with "whsec_".');
    }
    return secret;
  }

  try {
    const { stdout } = await execAsync('stripe listen --print-secret');
    const match = stdout.match(/whsec_[a-zA-Z0-9]+/);
    if (!match) {
      throw new Error('Failed to extract Stripe webhook secret');
    }
    console.log('Stripe webhook created (Development mode).');
    return match[0];
  } catch (error) {
    console.error(
      'Failed to create Stripe webhook. Check your Stripe CLI permissions.'
    );
    if (os.platform() === 'win32') {
      console.log('Note: On Windows, run as administrator.');
    }
    throw error;
  }
}

function generateAuthSecret(): string {
  console.log('Step 6: Security');
  console.log('Generating random AUTH_SECRET...');
  return crypto.randomBytes(32).toString('hex');
}

async function getBaseUrl(mode: 'local' | 'production'): Promise<{ baseUrl: string; nextWebhookUrl: string }> {
  console.log('Step 7: Application URL');
  
  const defaultUrl = mode === 'local' ? 'http://localhost:3000' : '';
  const promptText = mode === 'local' 
    ? 'Enter your website URL (Press Enter for "http://localhost:3000"): '
    : 'Enter your Production Website URL (e.g., https://myapp.com): ';

  const input = await question(promptText);
  
  const rawUrl = input.trim() || defaultUrl;
  
  if (!rawUrl) {
    console.error('Base URL is required for production.');
    process.exit(1);
  }

  const baseUrl = rawUrl.replace(/\/$/, '');
  const nextWebhookUrl = `${baseUrl}/api/webhook/evolution`;
  
  return { baseUrl, nextWebhookUrl };
}

async function getResendApiKey(): Promise<string> {
  console.log('Step 8: Resend Configuration (Email)');
  console.log('Get your API Key at: https://resend.com/api-keys');
  return await question('Enter your Resend API Key: ');
}

async function getPusherConfig(): Promise<Record<string, string>> {
  console.log('Step 9: Pusher Configuration (Realtime)');
  console.log('Find your credentials at: https://dashboard.pusher.com/');
  console.log('Go to: Channels -> Your App -> App Keys');
  
  const appId = await question('Enter App ID: ');
  const key = await question('Enter Key: ');
  const secret = await question('Enter Secret: ');
  const cluster = await question('Enter Cluster: ');

  return {
    PUSHER_APP_ID: appId,
    NEXT_PUBLIC_PUSHER_KEY: key,
    PUSHER_SECRET: secret,
    NEXT_PUBLIC_PUSHER_CLUSTER: cluster,
  };
}

async function getEvolutionConfig(): Promise<Record<string, string>> {
  console.log('Step 10: Evolution API Configuration (WhatsApp)');
  
  const apiUrlInput = await question('Enter Evolution API URL (e.g., https://api.yoursite.com): ');
  const apiUrl = apiUrlInput.trim().replace(/\/$/, '');

  const apiKey = await question('Enter Global API Key (Authentication): ');
  const webhookToken = await question('Enter Webhook Token (Secret): ');

  return {
    EVOLUTION_API_URL: apiUrl,
    NEXT_PUBLIC_EVOLUTION_WEBHOOK_URL: apiUrl,
    AUTHENTICATION_API_KEY: apiKey,
    NEXT_PUBLIC_EVOLUTION_WEBHOOK_TOKEN: webhookToken,
  };
}

async function writeEnvFile(envVars: Record<string, string>) {
  console.log('Step 11: Saving Configuration');
  const envContent = Object.entries(envVars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(path.join(process.cwd(), '.env'), envContent);
  console.log('.env file created successfully.');
}

async function main() {
  const mode = await getSetupMode();

  await checkStripeCLI(mode);

  const POSTGRES_URL = await getPostgresURL();
  const STRIPE_SECRET_KEY = await getStripeSecretKey();
  const STRIPE_WEBHOOK_SECRET = await getStripeWebhookSecret(mode);
  const AUTH_SECRET = generateAuthSecret();

  const { baseUrl: BASE_URL, nextWebhookUrl: NEXT_PUBLIC_WEBHOOK_URL } = await getBaseUrl(mode);
  const RESEND_API_KEY = await getResendApiKey();
  const pusherConfig = await getPusherConfig();
  const evolutionConfig = await getEvolutionConfig();

  await writeEnvFile({
    POSTGRES_URL,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    AUTH_SECRET,
    BASE_URL,
    NEXT_PUBLIC_WEBHOOK_URL,
    RESEND_API_KEY,
    ...pusherConfig,
    ...evolutionConfig,
  });

  console.log('🎉 Setup completed successfully!');
}

main().catch(console.error);
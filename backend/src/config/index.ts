import dotenv from 'dotenv';
import type { SignOptions } from 'jsonwebtoken';

dotenv.config();

const getRequiredEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  jwt: {
    secret: getRequiredEnv('JWT_SECRET'),
    expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as SignOptions['expiresIn'],
  },
  
  database: {
    url: getRequiredEnv('DATABASE_URL'),
  },
  
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? getRequiredEnv('FRONTEND_URL') 
      : (process.env.FRONTEND_URL || 'http://localhost:8080'),
  },
};

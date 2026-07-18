import { S3Client } from '@aws-sdk/client-s3';
import { DEFAULT_S3_REGION } from './constants';

export function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? DEFAULT_S3_REGION,
    forcePathStyle: true,
  });
}

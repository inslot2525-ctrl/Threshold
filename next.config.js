/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-rekognition', '@aws-sdk/client-sns'],
}

module.exports = nextConfig

import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// Keep manifest.json in step with package.json.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

// Record which app version this release needs, for older installs.
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);

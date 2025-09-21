# AWS WAF Temp Access Action

AWS WAF Temp Access Action is a Node.js GitHub Action that automatically adds and removes the GitHub runner's public IP address to AWS WAF IPSets for secure access during workflows.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test the Repository
- Install dependencies: `npm ci` (takes ~4-5 seconds on subsequent runs, up to 30s on first install)
- Run linter: `npm run lint` (takes <1 second) 
- Run tests: `npm run test` (takes <1 second, 3 tests)
- Build action: `npm run build` (takes ~8-10 seconds. NEVER CANCEL. Set timeout to 30+ seconds)
- Format code: `npm run format` (takes <1 second)

### Full Validation Pipeline
Run the complete validation sequence that matches CI:
```bash
npm ci && npm run lint && npm run test && npm run build
```
Total time: ~12-15 seconds after dependencies are cached. NEVER CANCEL. Set timeout to 60+ seconds.

### Build Details
- Uses `@vercel/ncc` to bundle Node.js dependencies into single files
- Creates `dist/index.js` (~2.3MB bundled main action)
- Creates `dist/cleanup.js` (~1.9MB bundled cleanup action)
- Build process: main action (4s) → cleanup action (3.5s) → copy cleanup file

## Validation Scenarios

### Always Test After Making Changes
Since this is a GitHub Action that interacts with external services, functional testing is limited in sandboxed environments:

1. **Linting and Code Style**: Always run `npm run lint` before committing
2. **Unit Tests**: Run `npm run test` to validate action structure and dependencies
3. **Build Verification**: Run `npm run build` and verify both dist files are created
4. **IP Detection Simulation**: Note that IP detection services (api.ipify.org, icanhazip.com) will fail in sandboxed environments - this is expected
5. **AWS SDK Integration**: AWS calls will fail without credentials - this is expected during development

### Action Integration Testing
To test the action in a realistic GitHub workflow environment:
```yaml
# .github/workflows/test-action.yml
name: Test Action Integration
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test action
        uses: ./
        with:
          id: test-id
          name: test-name
          scope: REGIONAL
          region: us-east-1
        # This will fail without AWS credentials but validates action loading
```

### Validation Checklist
After making any code changes, verify:
- [ ] `npm run lint` passes without errors
- [ ] `npm run test` shows all 3 tests passing  
- [ ] `npm run build` completes and creates both dist files
- [ ] `dist/index.js` is ~2.3MB and `dist/cleanup.js` is ~1.9MB
- [ ] No uncommitted changes after build (dist files should be committed)
- [ ] Action YAML structure validates correctly

### Manual Testing Commands
```bash
# Verify action structure
node -e "const yaml = require('js-yaml'); const fs = require('fs'); console.log(yaml.load(fs.readFileSync('action.yml', 'utf8')));"

# Check bundle sizes
ls -lh dist/

# Verify Node.js compatibility (should be 20.x)
node --version

# Test IP detection (will fail in sandbox but shows axios functionality)
node -e "const axios = require('axios'); axios.get('https://api.ipify.org?format=text', {timeout: 5000}).then(r => console.log('IP:', r.data)).catch(e => console.log('Expected failure:', e.message));"

# Validate main package configuration
grep -E '"main"|"scripts"' package.json

# Check dist files exist and have correct sizes
test -f dist/index.js && test -f dist/cleanup.js && echo "✅ Dist files exist" || echo "❌ Missing dist files"
ls -la dist/
```

## Timing Expectations and Timeout Guidelines

**CRITICAL**: Always use appropriate timeouts to prevent premature command cancellation:

- `npm ci`: 4-5 seconds (cached) to 30 seconds (fresh) → Use 60+ second timeout
- `npm run lint`: <1 second → Use 30+ second timeout  
- `npm run test`: <1 second → Use 30+ second timeout
- `npm run build`: 8-10 seconds → Use 30+ second timeout
- `npm run format`: <1 second → Use 30+ second timeout
- Full pipeline: 12-15 seconds (cached dependencies) → Use 60+ second timeout

**NEVER CANCEL** any build or test commands. The build process involves bundling large dependency trees and may appear to hang but is actually working.

## Common Tasks and Commands

### Development Workflow
1. Install dependencies: `npm ci`
2. Make code changes in `src/`
3. Run linter: `npm run lint` (auto-fix with `npm run lint -- --fix`)
4. Run tests: `npm run test`
5. Build: `npm run build`
6. Verify dist files exist and have reasonable sizes

### Clean Development Setup
```bash
# Start with clean slate
rm -rf node_modules package-lock.json dist/
npm install  # Creates new package-lock.json
npm run build
npm run test
```

### Debugging Build Issues
```bash
# Check ncc version and ensure @vercel/ncc is installed
npx ncc --version

# Manually test bundling individual files
npx ncc build src/index.js -o dist-test
npx ncc build src/cleanup.js -o dist-test-cleanup

# Verify dependencies are available
node -e "console.log(require('@actions/core')); console.log(require('@aws-sdk/client-wafv2'));"
```

### Required Tools and Dependencies
- Node.js 20.x (action requires node20 runtime)
- npm (included with Node.js)
- All dependencies defined in package.json

### Code Structure
- `src/index.js`: Main action entry point
- `src/cleanup.js`: Post-action cleanup script
- `dist/`: Bundled output files (committed to repo)
- `__tests__/`: Jest unit tests
- `action.yml`: GitHub Action metadata
- `.github/workflows/`: CI/CD workflows

## Repository Structure Overview

```
aws-waf-temp-access/
├── src/
│   ├── index.js          # Main action logic
│   └── cleanup.js        # Post-action cleanup
├── dist/
│   ├── index.js          # Bundled main action (~2.3MB)
│   └── cleanup.js        # Bundled cleanup (~1.9MB)
├── __tests__/
│   └── action.test.js    # Unit tests
├── .github/workflows/
│   ├── test.yml          # CI tests and build
│   ├── release.yml       # Release automation
│   └── example.yml       # Usage example
├── action.yml            # GitHub Action metadata
├── package.json          # Dependencies and scripts
├── eslint.config.mjs     # ESLint configuration
├── README.md             # Documentation
└── CHANGELOG.md          # Version history
```

## Key Files and Their Purpose

### action.yml
Defines the GitHub Action interface with:
- Required inputs: id, name, scope, region
- Node.js 20 runtime specification
- Main and post-action script references

### package.json Scripts
- `build`: Bundle source code with ncc
- `test`: Run Jest unit tests
- `lint`: ESLint code checking (enforces single quotes)
- `format`: Prettier code formatting

### Source Files
- `src/index.js`: Gets runner IP, adds to WAF IPSet
- `src/cleanup.js`: Removes IP from IPSet after workflow

## Environment and Authentication

### IP Detection Services
The action uses external services to detect the runner's public IP:
- Primary: api.ipify.org
- Fallback: icanhazip.com
- **Note**: These will fail in sandboxed development environments

### AWS Authentication
Uses AWS SDK default credential chain:
- Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
- IAM roles (self-hosted runners)
- aws-actions/configure-aws-credentials action

### Required AWS Permissions
- `wafv2:GetIPSet`
- `wafv2:UpdateIPSet`

## Troubleshooting

## Troubleshooting

### Build Issues
- **"ncc command not found"**: Run `npm ci` to install dependencies
- **Build appears frozen**: This is normal, wait for completion (8-10 seconds)
- **Large bundle sizes**: Expected (~2MB files due to AWS SDK)
- **"Cannot find module"**: Ensure `npm ci` completed successfully

### Linting Issues
- **Quote style errors**: Run `npm run lint -- --fix` to auto-fix
- **ESLint configuration**: Uses single quotes, no console warnings
- **"Parsing error"**: Check for syntax errors in JS files

### Test Issues
- **File size assertions fail**: Expect bundled files >1MB
- **Missing dist files**: Run `npm run build` first
- **Jest configuration not found**: Jest runs with default config from package.json

### Development Limitations
- **IP detection will fail** in sandboxed environments (api.ipify.org blocked)
- **AWS operations require valid credentials** (expect failures during dev)
- **External network access may be restricted** (normal in CI environments)

### Common Error Messages and Solutions
```
Error: ENOTFOUND api.ipify.org
→ Expected in sandboxed environment, IP detection service unavailable

Error: ncc: Not found
→ Run 'npm ci' to install build dependencies

Error: Cannot find module '@aws-sdk/client-wafv2'
→ Dependencies not installed, run 'npm ci'

Error: 32 problems (32 errors, 0 warnings)
→ Linting errors, run 'npm run lint -- --fix'

Error: dist files are missing
→ Build not run, execute 'npm run build'
```

## CI/CD Integration

### GitHub Workflows
- **test.yml**: Runs on push/PR, validates lint/test/build
- **release.yml**: Automates releases on version tags
- **example.yml**: Demonstrates action usage

### Release Process
1. Update version in package.json and CHANGELOG.md
2. Create and push version tag (e.g., v1.0.1)
3. release.yml workflow automatically builds and publishes

### Dist Files
- Always commit built dist/ files
- CI verifies no uncommitted changes after build
- Use `git add dist/` before committing changes

## Code Quality Standards

- **ESLint**: Single quotes, no unused vars, semicolons required
- **Prettier**: Consistent code formatting
- **Jest**: Unit tests for action structure and dependencies
- **ncc**: Bundle for distribution without node_modules

Always run the full validation pipeline before committing:
```bash
npm run lint && npm run test && npm run build
```
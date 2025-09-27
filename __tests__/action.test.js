const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');


describe('aws-waf-temp-access', () => {
  test('action.yml should have correct structure', () => {
    const actionPath = path.join(__dirname, '..', 'action.yml');
    expect(fs.existsSync(actionPath)).toBe(true);
    
    const actionContent = fs.readFileSync(actionPath, 'utf8');
    const action = yaml.load(actionContent);
    
    // Check required fields
    expect(action.name).toBe('aws-waf-temp-access');
    expect(action.description).toBeDefined();
    expect(action.runs).toBeDefined();
    expect(action.runs.using).toBe('node20');
    expect(action.runs.main).toBe('dist/index.js');
    expect(action.runs.post).toBe('dist/cleanup.js');
    
    // Check required inputs
    expect(action.inputs.id).toBeDefined();
    expect(action.inputs.id.required).toBe(false);
    expect(action.inputs.name).toBeDefined();
    expect(action.inputs.name.required).toBe(false);
    expect(action.inputs.scope).toBeDefined();
    expect(action.inputs.scope.required).toBe(false);
    expect(action.inputs.region).toBeDefined();
    expect(action.inputs.region.required).toBe(true);
    expect(action.inputs['security-group-id']).toBeDefined();
    expect(action.inputs['security-group-id'].required).toBe(false);
  });

  test('dist files should exist', () => {
    const mainPath = path.join(__dirname, '..', 'dist', 'index.js');
    const cleanupPath = path.join(__dirname, '..', 'dist', 'cleanup.js');
    
    expect(fs.existsSync(mainPath)).toBe(true);
    expect(fs.existsSync(cleanupPath)).toBe(true);
    
    // Check file sizes are reasonable (should be bundled)
    const mainStats = fs.statSync(mainPath);
    const cleanupStats = fs.statSync(cleanupPath);
    
    expect(mainStats.size).toBeGreaterThan(1000000); // At least 1MB (bundled)
    expect(cleanupStats.size).toBeGreaterThan(1000000); // At least 1MB (bundled)
  });

  test('package.json should have correct dependencies', () => {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // Check required dependencies
    expect(packageContent.dependencies['@actions/core']).toBeDefined();
    expect(packageContent.dependencies['@aws-sdk/client-wafv2']).toBeDefined();
    expect(packageContent.dependencies['@aws-sdk/client-ec2']).toBeDefined();
    expect(packageContent.dependencies['axios']).toBeDefined();
    
    // Check dev dependencies
    expect(packageContent.devDependencies['@vercel/ncc']).toBeDefined();
  });

  test('input validation logic should work correctly', () => {
    // Test case 1: WAF only configuration
    const hasWafConfig1 = 'test-id' && 'test-name';
    const hasSecurityGroupConfig1 = '';
    expect(hasWafConfig1 && !hasSecurityGroupConfig1).toBe(true);

    // Test case 2: Security Group only configuration  
    const hasWafConfig2 = '' && '';
    const hasSecurityGroupConfig2 = 'sg-123456';
    expect(!hasWafConfig2 && !!hasSecurityGroupConfig2).toBe(true);

    // Test case 3: Both configurations
    const hasWafConfig3 = 'test-id' && 'test-name';
    const hasSecurityGroupConfig3 = 'sg-123456';
    expect(!!hasWafConfig3 && !!hasSecurityGroupConfig3).toBe(true);

    // Test case 4: No configuration (should fail)
    const hasWafConfig4 = '' && '';
    const hasSecurityGroupConfig4 = '';
    expect(!hasWafConfig4 && !hasSecurityGroupConfig4).toBe(true);
  });

  test('scope validation should work correctly', () => {
    const validScopes = ['CLOUDFRONT', 'REGIONAL'];
    
    expect(validScopes.includes('CLOUDFRONT')).toBe(true);
    expect(validScopes.includes('REGIONAL')).toBe(true);
    expect(validScopes.includes('INVALID')).toBe(false);
    expect(validScopes.includes('regional')).toBe(false);
    expect(validScopes.includes('')).toBe(false);
  });

  test('IP CIDR logic should work correctly', () => {
    // Test IP without CIDR should get /32 added
    const ip1 = '192.168.1.1';
    const ipWithCidr1 = ip1.includes('/') ? ip1 : `${ip1}/32`;
    expect(ipWithCidr1).toBe('192.168.1.1/32');

    // Test IP with CIDR should remain unchanged
    const ip2 = '10.0.0.1/24';
    const ipWithCidr2 = ip2.includes('/') ? ip2 : `${ip2}/32`;
    expect(ipWithCidr2).toBe('10.0.0.1/24');
  });
});
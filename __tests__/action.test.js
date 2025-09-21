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
    expect(action.inputs.id.required).toBe(true);
    expect(action.inputs.name).toBeDefined();
    expect(action.inputs.name.required).toBe(true);
    expect(action.inputs.scope).toBeDefined();
    expect(action.inputs.scope.required).toBe(true);
    expect(action.inputs.region).toBeDefined();
    expect(action.inputs.region.required).toBe(true);
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
    expect(packageContent.dependencies['axios']).toBeDefined();
    
    // Check dev dependencies
    expect(packageContent.devDependencies['@vercel/ncc']).toBeDefined();
  });
});
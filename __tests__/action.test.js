const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Mock AWS SDK clients and @actions/core for testing
const mockWAFv2Client = jest.fn();
const mockEC2Client = jest.fn();

jest.mock('@aws-sdk/client-wafv2', () => ({
  WAFv2Client: mockWAFv2Client,
  UpdateIPSetCommand: jest.fn(),
  GetIPSetCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: mockEC2Client,
  AuthorizeSecurityGroupIngressCommand: jest.fn(),
}));

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  setFailed: jest.fn(),
  setOutput: jest.fn(),
  saveState: jest.fn(),
  getState: jest.fn(),
  getInput: jest.fn(),
}));

jest.mock('axios', () => ({
  get: jest.fn(),
}));

const { 
  getPublicIP, 
  createWAFClient, 
  createEC2Client,
  addIPToIPSet,
  addIPToSecurityGroup 
} = require('../src/index.js');

const core = require('@actions/core');
const axios = require('axios');

describe('aws-waf-temp-access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
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
    expect(action.inputs['security-group-description']).toBeDefined();
    expect(action.inputs['security-group-description'].required).toBe(false);
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

  test('createWAFClient should return WAFv2Client instance', () => {
    const region = 'us-east-1';
    const client = createWAFClient(region);
    
    expect(mockWAFv2Client).toHaveBeenCalledWith({ region });
    expect(client).toBeDefined();
  });

  test('createEC2Client should return EC2Client instance', () => {
    const region = 'us-west-2';
    const client = createEC2Client(region);
    
    expect(mockEC2Client).toHaveBeenCalledWith({ region });
    expect(client).toBeDefined();
  });

  test('getPublicIP should return IP from primary service', async () => {
    const mockIP = '192.168.1.1';
    axios.get.mockResolvedValueOnce({ data: `  ${mockIP}  ` });
    
    const result = await getPublicIP();
    
    expect(axios.get).toHaveBeenCalledWith('https://api.ipify.org?format=text', {
      timeout: 10000,
    });
    expect(result).toBe(mockIP);
  });

  test('getPublicIP should fallback to secondary service when primary fails', async () => {
    const mockIP = '10.0.0.1';
    axios.get
      .mockRejectedValueOnce(new Error('Primary service failed'))
      .mockResolvedValueOnce({ data: `${mockIP}\n` });
    
    const result = await getPublicIP();
    
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenNthCalledWith(1, 'https://api.ipify.org?format=text', {
      timeout: 10000,
    });
    expect(axios.get).toHaveBeenNthCalledWith(2, 'https://icanhazip.com/', {
      timeout: 10000,
    });
    expect(result).toBe(mockIP);
  });

  test('getPublicIP should throw error when both services fail', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('Primary service failed'))
      .mockRejectedValueOnce(new Error('Secondary service failed'));
    
    await expect(getPublicIP()).rejects.toThrow('Failed to get public IP: Secondary service failed');
  });

  test('addIPToSecurityGroup should handle IP without CIDR correctly', async () => {
    const mockClient = {
      send: jest.fn().mockResolvedValue({}),
      config: { region: 'us-east-1' }
    };
    const groupId = 'sg-123456789';
    const ipAddress = '192.168.1.1';
    const description = 'Test description';
    
    core.info = jest.fn();
    core.saveState = jest.fn();
    
    await addIPToSecurityGroup(mockClient, groupId, ipAddress, description);
    
    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).toHaveBeenCalledWith('sg-runner-ip', '192.168.1.1/32');
    expect(core.saveState).toHaveBeenCalledWith('sg-group-id', groupId);
    expect(core.saveState).toHaveBeenCalledWith('sg-description', description);
    expect(core.saveState).toHaveBeenCalledWith('sg-aws-region', 'us-east-1');
    expect(core.info).toHaveBeenCalledWith('Adding IP 192.168.1.1/32 to Security Group sg-123456789...');
  });

  test('addIPToSecurityGroup should handle IP with CIDR correctly', async () => {
    const mockClient = {
      send: jest.fn().mockResolvedValue({}),
      config: { region: 'us-east-1' }
    };
    const groupId = 'sg-123456789';
    const ipAddress = '10.0.0.0/24';
    
    core.info = jest.fn();
    core.saveState = jest.fn();
    
    await addIPToSecurityGroup(mockClient, groupId, ipAddress); // Test without description (default)
    
    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).toHaveBeenCalledWith('sg-runner-ip', '10.0.0.0/24');
    expect(core.saveState).toHaveBeenCalledWith('sg-description', 'Temporary access from GitHub Actions runner');
    expect(core.info).toHaveBeenCalledWith('Adding IP 10.0.0.0/24 to Security Group sg-123456789...');
  });
});
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Mock AWS SDK clients and @actions/core for testing
const mockWAFV2Client = jest.fn();
const mockEC2Client = jest.fn();

jest.mock('@aws-sdk/client-wafv2', () => ({
  WAFV2Client: mockWAFV2Client,
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
  sleep,
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
    expect(action.runs.using).toBe('node26');
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
    expect(action.inputs.region.required).toBe(false);
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

  test('createWAFClient should return WAFV2Client instance', () => {
    const region = 'us-east-1';
    const client = createWAFClient(region);

    expect(mockWAFV2Client).toHaveBeenCalledWith({ region });
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
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
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
    expect(core.saveState).toHaveBeenCalledWith('sg-port', '443');
    expect(core.saveState).toHaveBeenCalledWith('sg-protocol', 'tcp');
    expect(core.info).toHaveBeenCalledWith('Adding IP 192.168.1.1/32 to Security Group sg-123456789...');
  });

  test('addIPToSecurityGroup should handle IP with CIDR correctly', async () => {
    const mockClient = {
      send: jest.fn().mockResolvedValue({}),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };
    const groupId = 'sg-123456789';
    const ipAddress = '10.0.0.0/24';

    core.info = jest.fn();
    core.saveState = jest.fn();

    await addIPToSecurityGroup(mockClient, groupId, ipAddress); // Test without description (default)

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).toHaveBeenCalledWith('sg-runner-ip', '10.0.0.0/24');
    expect(core.saveState).toHaveBeenCalledWith('sg-aws-region', 'us-east-1');
    expect(core.saveState).toHaveBeenCalledWith('sg-description', 'Temporary access from GitHub Actions runner');
    expect(core.saveState).toHaveBeenCalledWith('sg-port', '443');
    expect(core.saveState).toHaveBeenCalledWith('sg-protocol', 'tcp');
    expect(core.info).toHaveBeenCalledWith('Adding IP 10.0.0.0/24 to Security Group sg-123456789...');
  });

  test('addIPToSecurityGroup should support custom port and protocol', async () => {
    const { AuthorizeSecurityGroupIngressCommand } = require('@aws-sdk/client-ec2');
    const mockClient = {
      send: jest.fn().mockResolvedValue({}),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };
    const groupId = 'sg-123456789';
    const ipAddress = '192.168.1.1';
    const description = 'Custom port test';

    core.info = jest.fn();
    core.saveState = jest.fn();

    await addIPToSecurityGroup(mockClient, groupId, ipAddress, description, 5432, 'udp');

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).toHaveBeenCalledWith('sg-port', '5432');
    expect(core.saveState).toHaveBeenCalledWith('sg-protocol', 'udp');

    expect(AuthorizeSecurityGroupIngressCommand).toHaveBeenLastCalledWith({
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: 'udp',
          FromPort: 5432,
          ToPort: 5432,
          IpRanges: [
            {
              CidrIp: '192.168.1.1/32',
              Description: description,
            },
          ],
        },
      ],
    });
  });

  test('addIPToSecurityGroup should support all/any protocols without port spec', async () => {
    const { AuthorizeSecurityGroupIngressCommand } = require('@aws-sdk/client-ec2');
    const mockClient = {
      send: jest.fn().mockResolvedValue({}),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };
    const groupId = 'sg-123456789';
    const ipAddress = '192.168.1.1';

    core.info = jest.fn();
    core.saveState = jest.fn();

    await addIPToSecurityGroup(mockClient, groupId, ipAddress, undefined, -1, 'all');

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).toHaveBeenCalledWith('sg-port', '-1');
    expect(core.saveState).toHaveBeenCalledWith('sg-protocol', 'all');

    expect(AuthorizeSecurityGroupIngressCommand).toHaveBeenLastCalledWith({
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: '-1',
          IpRanges: [
            {
              CidrIp: '192.168.1.1/32',
              Description: 'Temporary access from GitHub Actions runner',
            },
          ],
        },
      ],
    });
  });

  test('addIPToIPSet should add IP to WAF IPSet when it is not present', async () => {
    const mockClient = {
      send: jest.fn()
        .mockResolvedValueOnce({
          IPSet: { Addresses: ['192.168.1.2/32'] },
          LockToken: 'lock-token-123',
        })
        .mockResolvedValueOnce({}),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };
    const id = 'ipset-123';
    const name = 'test-ipset';
    const scope = 'REGIONAL';
    const ipAddress = '192.168.1.1';

    core.info = jest.fn();
    core.saveState = jest.fn();

    const result = await addIPToIPSet(mockClient, id, name, scope, ipAddress);

    expect(result).toBe(true);
    expect(mockClient.send).toHaveBeenCalledTimes(2);
    expect(core.saveState).toHaveBeenCalledWith('runner-ip', '192.168.1.1/32');
    expect(core.saveState).toHaveBeenCalledWith('ipset-id', id);
    expect(core.saveState).toHaveBeenCalledWith('ipset-name', name);
    expect(core.saveState).toHaveBeenCalledWith('ipset-scope', scope);
    expect(core.saveState).toHaveBeenCalledWith('aws-region', 'us-east-1');
  });

  test('addIPToIPSet should not add IP to WAF IPSet when it is already present', async () => {
    const mockClient = {
      send: jest.fn().mockResolvedValueOnce({
        IPSet: { Addresses: ['192.168.1.1/32'] },
        LockToken: 'lock-token-123',
      }),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };
    const id = 'ipset-123';
    const name = 'test-ipset';
    const scope = 'REGIONAL';
    const ipAddress = '192.168.1.1';

    core.info = jest.fn();
    core.saveState = jest.fn();

    const result = await addIPToIPSet(mockClient, id, name, scope, ipAddress);

    expect(result).toBe(false);
    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.saveState).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith('IP 192.168.1.1/32 is already in the IPSet');
  });

  test('addIPToIPSet should retry when WAFOptimisticLockException is thrown and succeed eventually', async () => {
    jest.useFakeTimers();
    const mockClient = {
      send: jest.fn()
        // First attempt: Get IPSet (success)
        .mockResolvedValueOnce({
          IPSet: { Addresses: [] },
          LockToken: 'lock-token-1',
        })
        // First attempt: Update IPSet (lock conflict)
        .mockRejectedValueOnce({ name: 'WAFOptimisticLockException' })
        // Second attempt: Get IPSet (success)
        .mockResolvedValueOnce({
          IPSet: { Addresses: [] },
          LockToken: 'lock-token-2',
        })
        // Second attempt: Update IPSet (success)
        .mockResolvedValueOnce({}),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };

    core.warning = jest.fn();
    core.saveState = jest.fn();

    const promise = addIPToIPSet(mockClient, 'ipset-123', 'test-ipset', 'REGIONAL', '192.168.1.1');

    // Fast-forward timers
    await jest.runAllTimersAsync();
    await promise;

    expect(mockClient.send).toHaveBeenCalledTimes(4);
    expect(core.warning).toHaveBeenCalled();
    expect(core.saveState).toHaveBeenCalledWith('runner-ip', '192.168.1.1/32');
    jest.useRealTimers();
  });

  test('addIPToIPSet should throw error after max retries due to lock conflicts', async () => {
    jest.useFakeTimers();
    const mockClient = {
      send: jest.fn().mockImplementation(async (command) => {
        // Return GetIPSet response, throw on UpdateIPSet
        if (command.constructor.name === 'UpdateIPSetCommand' || mockClient.send.mock.calls.length % 2 === 0) {
          throw { name: 'WAFOptimisticLockException' };
        }
        return {
          IPSet: { Addresses: [] },
          LockToken: 'lock-token-1',
        };
      }),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };

    core.warning = jest.fn();

    const promise = addIPToIPSet(mockClient, 'ipset-123', 'test-ipset', 'REGIONAL', '192.168.1.1');
    const expectPromise = expect(promise).rejects.toThrow('Failed to add IP to IPSet after 10 attempts due to lock conflicts');

    await jest.runAllTimersAsync();
    await expectPromise;

    expect(mockClient.send).toHaveBeenCalledTimes(20); // 10 gets, 10 updates
    expect(core.warning).toHaveBeenCalledTimes(10);
    jest.useRealTimers();
  });

  test('addIPToIPSet should throw non-lock exceptions immediately', async () => {
    const mockClient = {
      send: jest.fn()
        .mockResolvedValueOnce({
          IPSet: { Addresses: [] },
          LockToken: 'lock-token-1',
        })
        .mockRejectedValueOnce(new Error('Some other AWS error')),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };

    await expect(
      addIPToIPSet(mockClient, 'ipset-123', 'test-ipset', 'REGIONAL', '192.168.1.1')
    ).rejects.toThrow('Some other AWS error');

    expect(mockClient.send).toHaveBeenCalledTimes(2);
  });

  test('addIPToSecurityGroup should exit early if IP is already in Security Group (InvalidPermission.Duplicate)', async () => {
    const mockClient = {
      send: jest.fn().mockRejectedValue({ name: 'InvalidPermission.Duplicate' }),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };

    core.info = jest.fn();
    core.saveState = jest.fn();

    await addIPToSecurityGroup(mockClient, 'sg-123', '192.168.1.1');

    expect(mockClient.send).toHaveBeenCalledTimes(1);
    expect(core.info).toHaveBeenCalledWith('IP 192.168.1.1/32 is already allowed in Security Group sg-123');
    expect(core.saveState).not.toHaveBeenCalled();
  });

  test('addIPToSecurityGroup should retry on failure and eventually throw after maxRetries', async () => {
    jest.useFakeTimers();
    const mockClient = {
      send: jest.fn().mockRejectedValue(new Error('Network error')),
      config: { region: jest.fn().mockResolvedValue('us-east-1') },
    };

    core.warning = jest.fn();

    const promise = addIPToSecurityGroup(mockClient, 'sg-123', '192.168.1.1');
    const expectPromise = expect(promise).rejects.toThrow('Network error');

    // Fast-forward timers for retries
    await jest.runAllTimersAsync();

    await expectPromise;
    // maxRetries is 5, so it should be called 5 times
    expect(mockClient.send).toHaveBeenCalledTimes(5);
    expect(core.warning).toHaveBeenCalledTimes(4);
    jest.useRealTimers();
  });

  test('sleep function should wait for specified milliseconds', async () => {
    jest.useFakeTimers();
    
    const startTime = Date.now();
    const promise = sleep(1000);
    
    expect(Date.now() - startTime).toBeLessThan(100); // Should not have waited yet
    
    jest.advanceTimersByTime(1000);
    await promise;
    
    jest.useRealTimers();
  });

  describe('main', () => {
    const { main } = require('../src/index.js');

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      // Setup default mock implementation for clients
      mockWAFV2Client.mockImplementation(() => ({
        send: jest.fn()
          .mockResolvedValueOnce({
            IPSet: { Addresses: [] },
            LockToken: 'lock-token-123',
          })
          .mockResolvedValueOnce({}),
        config: { region: jest.fn().mockResolvedValue('us-east-1') },
      }));

      mockEC2Client.mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({}),
        config: { region: jest.fn().mockResolvedValue('us-east-1') },
      }));

      // Mock getPublicIP dependencies
      axios.get.mockResolvedValue({ data: '1.2.3.4' });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('main should configure WAF IPSet when only WAF config is provided', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'id') return 'ipset-123';
        if (name === 'name') return 'test-ipset';
        if (name === 'scope') return 'REGIONAL';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();
      core.saveState = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockWAFV2Client).toHaveBeenCalled();
      expect(mockEC2Client).not.toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('ip-address', '1.2.3.4');
      expect(core.setOutput).toHaveBeenCalledWith('status', 'success');
    });

    test('main should configure Security Group when only SG config is provided', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'security-group-id') return 'sg-123';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockWAFV2Client).not.toHaveBeenCalled();
      expect(mockEC2Client).toHaveBeenCalled();
      expect(core.setOutput).toHaveBeenCalledWith('ip-address', '1.2.3.4');
      expect(core.setOutput).toHaveBeenCalledWith('status', 'success');
    });

    test('main should throw if neither WAF nor SG config is provided', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.setFailed = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Either WAF IPSet configuration (id, name) or Security Group configuration (security-group-id) must be provided')
      );
    });

    test('main should throw if WAF scope is invalid', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'id') return 'ipset-123';
        if (name === 'name') return 'test-ipset';
        if (name === 'scope') return 'INVALID_SCOPE';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.setFailed = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Invalid scope: INVALID_SCOPE. Must be CLOUDFRONT or REGIONAL')
      );
    });

    test('main should wait 30 seconds after WAF IPSet update', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'id') return 'ipset-123';
        if (name === 'name') return 'test-ipset';
        if (name === 'scope') return 'REGIONAL';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();
      core.saveState = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(core.info).toHaveBeenCalledWith('Waiting 30 seconds for WAF IPSet changes to propagate...');
      expect(core.info).toHaveBeenCalledWith('WAF IPSet propagation wait completed');
    });

    test('main should not wait if WAF IPSet already contains the IP', async () => {
      // Mock IPSet already containing the IP
      mockWAFV2Client.mockImplementation(() => ({
        send: jest.fn().mockResolvedValueOnce({
          IPSet: { Addresses: ['1.2.3.4/32'] },
          LockToken: 'lock-token-123',
        }),
        config: { region: jest.fn().mockResolvedValue('us-east-1') },
      }));

      core.getInput.mockImplementation((name) => {
        if (name === 'id') return 'ipset-123';
        if (name === 'name') return 'test-ipset';
        if (name === 'scope') return 'REGIONAL';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(core.info).not.toHaveBeenCalledWith('Waiting 30 seconds for WAF IPSet changes to propagate...');
    });

    test('main should not wait for propagation when only Security Group is configured', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'security-group-id') return 'sg-123';
        if (name === 'security-group-port') return '443';
        if (name === 'security-group-protocol') return 'tcp';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();
      core.saveState = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockWAFV2Client).not.toHaveBeenCalled();
      expect(mockEC2Client).toHaveBeenCalled();
      expect(core.info).not.toHaveBeenCalledWith('Waiting 30 seconds for WAF IPSet changes to propagate...');
      expect(core.setOutput).toHaveBeenCalledWith('ip-address', '1.2.3.4');
      expect(core.setOutput).toHaveBeenCalledWith('status', 'success');
    });

    test('main should wait for WAF propagation but not delay Security Group update when both are configured', async () => {
      core.getInput.mockImplementation((name) => {
        if (name === 'id') return 'ipset-123';
        if (name === 'name') return 'test-ipset';
        if (name === 'scope') return 'REGIONAL';
        if (name === 'security-group-id') return 'sg-123';
        if (name === 'region') return 'us-east-1';
        return '';
      });

      core.info = jest.fn();
      core.setOutput = jest.fn();
      core.saveState = jest.fn();

      const promise = main();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockWAFV2Client).toHaveBeenCalled();
      expect(mockEC2Client).toHaveBeenCalled();
      
      // Verify the order: WAF update, wait message, wait complete message, then SG operations
      const infoCalls = core.info.mock.calls.map(call => call[0]);
      const waitStartIndex = infoCalls.indexOf('Waiting 30 seconds for WAF IPSet changes to propagate...');
      const waitEndIndex = infoCalls.indexOf('WAF IPSet propagation wait completed');
      
      expect(waitStartIndex).toBeGreaterThan(-1);
      expect(waitEndIndex).toBeGreaterThan(waitStartIndex);
      
      expect(core.setOutput).toHaveBeenCalledWith('ip-address', '1.2.3.4');
      expect(core.setOutput).toHaveBeenCalledWith('status', 'success');
    });
  });
});

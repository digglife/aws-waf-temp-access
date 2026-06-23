const core = require('@actions/core');

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
  RevokeSecurityGroupIngressCommand: jest.fn(),
}));

jest.mock('@actions/core', () => ({
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  getState: jest.fn(),
}));

const {
  createWAFClient,
  createEC2Client,
  removeIPFromIPSet,
  removeIPFromSecurityGroup,
  cleanup,
} = require('../src/cleanup.js');

describe('cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('removeIPFromIPSet', () => {
    test('should remove IP when it is present in the set', async () => {
      const mockClient = {
        send: jest.fn()
          .mockResolvedValueOnce({
            IPSet: { Addresses: ['192.168.1.1/32', '192.168.1.2/32'] },
            LockToken: 'lock-token-123',
          })
          .mockResolvedValueOnce({}),
      };

      core.info = jest.fn();

      await removeIPFromIPSet(
        mockClient,
        'ipset-123',
        'test-ipset',
        'REGIONAL',
        '192.168.1.1/32'
      );

      expect(mockClient.send).toHaveBeenCalledTimes(2);
      expect(core.info).toHaveBeenCalledWith('Successfully removed IP 192.168.1.1/32 from IPSet test-ipset');
    });

    test('should exit early when IP is not in the set', async () => {
      const mockClient = {
        send: jest.fn().mockResolvedValueOnce({
          IPSet: { Addresses: ['192.168.1.2/32'] },
          LockToken: 'lock-token-123',
        }),
      };

      core.info = jest.fn();

      await removeIPFromIPSet(
        mockClient,
        'ipset-123',
        'test-ipset',
        'REGIONAL',
        '192.168.1.1/32'
      );

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith('IP 192.168.1.1/32 is not in the IPSet, no cleanup needed');
    });

    test('should retry on WAFOptimisticLockException and succeed', async () => {
      jest.useFakeTimers();
      const mockClient = {
        send: jest.fn()
          // First attempt: Get IPSet (success)
          .mockResolvedValueOnce({
            IPSet: { Addresses: ['192.168.1.1/32'] },
            LockToken: 'lock-token-1',
          })
          // First attempt: Update (lock exception)
          .mockRejectedValueOnce({ name: 'WAFOptimisticLockException' })
          // Second attempt: Get IPSet (success)
          .mockResolvedValueOnce({
            IPSet: { Addresses: ['192.168.1.1/32'] },
            LockToken: 'lock-token-2',
          })
          // Second attempt: Update (success)
          .mockResolvedValueOnce({}),
      };

      core.warning = jest.fn();

      const promise = removeIPFromIPSet(
        mockClient,
        'ipset-123',
        'test-ipset',
        'REGIONAL',
        '192.168.1.1/32'
      );

      await jest.runAllTimersAsync();
      await promise;

      expect(mockClient.send).toHaveBeenCalledTimes(4);
      expect(core.warning).toHaveBeenCalled();
      jest.useRealTimers();
    });

    test('should log warning and exit after max retries', async () => {
      jest.useFakeTimers();
      const mockClient = {
        send: jest.fn()
          .mockResolvedValue({
            IPSet: { Addresses: ['192.168.1.1/32'] },
            LockToken: 'lock-token-1',
          }),
      };

      // Mock update to always throw lock exception
      mockClient.send.mockImplementation(async (command) => {
        // Check if it's update or get command (or we can just mock client.send return value sequentially)
        // Since we did mockResolvedValue above, we overwrite for update
        if (command.constructor.name === 'UpdateIPSetCommand' || mockClient.send.mock.calls.length % 2 === 0) {
          throw { name: 'WAFOptimisticLockException' };
        }
        return {
          IPSet: { Addresses: ['192.168.1.1/32'] },
          LockToken: 'lock-token-1',
        };
      });

      core.warning = jest.fn();

      const promise = removeIPFromIPSet(
        mockClient,
        'ipset-123',
        'test-ipset',
        'REGIONAL',
        '192.168.1.1/32'
      );

      await jest.runAllTimersAsync();
      await promise;

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup IP after 10 attempts')
      );
      jest.useRealTimers();
    });

    test('should retry on general exceptions in removeIPFromIPSet and log warning after max retries', async () => {
      jest.useFakeTimers();
      const mockClient = {
        send: jest.fn().mockRejectedValue(new Error('General AWS error')),
      };

      core.warning = jest.fn();

      const promise = removeIPFromIPSet(
        mockClient,
        'ipset-123',
        'test-ipset',
        'REGIONAL',
        '192.168.1.1/32'
      );

      await jest.runAllTimersAsync();
      await promise;

      expect(mockClient.send).toHaveBeenCalledTimes(10);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup IP after 10 attempts')
      );
      jest.useRealTimers();
    });
  });

  describe('removeIPFromSecurityGroup', () => {
    test('should remove IP from security group successfully', async () => {
      const mockClient = {
        send: jest.fn().mockResolvedValue({}),
      };

      core.info = jest.fn();

      await removeIPFromSecurityGroup(mockClient, 'sg-123', '192.168.1.1/32', 'Test Description');

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith('Successfully removed IP 192.168.1.1/32 from Security Group sg-123');
    });

    test('should exit early when IP permission not found in security group', async () => {
      const mockClient = {
        send: jest.fn().mockRejectedValue({ name: 'InvalidPermission.NotFound' }),
      };

      core.info = jest.fn();

      await removeIPFromSecurityGroup(mockClient, 'sg-123', '192.168.1.1/32');

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith('IP 192.168.1.1/32 is not in Security Group sg-123, no cleanup needed');
    });

    test('should retry on other errors and eventually fail', async () => {
      jest.useFakeTimers();
      const mockClient = {
        send: jest.fn().mockRejectedValue(new Error('Network failure')),
      };

      core.warning = jest.fn();

      const promise = removeIPFromSecurityGroup(mockClient, 'sg-123', '192.168.1.1/32');

      await jest.runAllTimersAsync();
      await promise;

      expect(mockClient.send).toHaveBeenCalledTimes(5);
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Failed to cleanup IP from Security Group after 5 attempts')
      );
      jest.useRealTimers();
    });
  });

  describe('cleanup function', () => {
    test('should exit early when no cleanup state is found', async () => {
      core.getState.mockReturnValue('');
      core.info = jest.fn();

      await cleanup();

      expect(core.info).toHaveBeenCalledWith('No cleanup state found, skipping IP removal');
      expect(mockWAFV2Client).not.toHaveBeenCalled();
      expect(mockEC2Client).not.toHaveBeenCalled();
    });

    test('should cleanup WAF IPSet when WAF state is present', async () => {
      core.getState.mockImplementation((key) => {
        if (key === 'runner-ip') return '192.168.1.1/32';
        if (key === 'ipset-id') return 'ipset-123';
        if (key === 'ipset-name') return 'test-ipset';
        if (key === 'ipset-scope') return 'REGIONAL';
        if (key === 'aws-region') return 'us-east-1';
        return '';
      });

      const mockWAF = {
        send: jest.fn()
          .mockResolvedValueOnce({
            IPSet: { Addresses: ['192.168.1.1/32'] },
            LockToken: 'lock-token-123',
          })
          .mockResolvedValueOnce({}),
      };
      mockWAFV2Client.mockReturnValue(mockWAF);
      core.info = jest.fn();

      await cleanup();

      expect(mockWAFV2Client).toHaveBeenCalledWith({ region: 'us-east-1' });
      expect(mockWAF.send).toHaveBeenCalledTimes(2);
      expect(core.info).toHaveBeenCalledWith('WAF cleanup completed successfully');
    });

    test('should cleanup Security Group when SG state is present', async () => {
      core.getState.mockImplementation((key) => {
        if (key === 'sg-runner-ip') return '192.168.1.1/32';
        if (key === 'sg-group-id') return 'sg-123';
        if (key === 'sg-aws-region') return 'us-west-2';
        if (key === 'sg-description') return 'Temp description';
        return '';
      });

      const mockEC2 = {
        send: jest.fn().mockResolvedValue({}),
      };
      mockEC2Client.mockReturnValue(mockEC2);
      core.info = jest.fn();

      await cleanup();

      expect(mockEC2Client).toHaveBeenCalledWith({ region: 'us-west-2' });
      expect(mockEC2.send).toHaveBeenCalledTimes(1);
      expect(core.info).toHaveBeenCalledWith('Security Group cleanup completed successfully');
    });

    test('should catch and log errors during cleanup', async () => {
      core.getState.mockImplementation(() => {
        throw new Error('State read error');
      });
      core.warning = jest.fn();
      core.debug = jest.fn();

      await cleanup();

      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Cleanup failed: State read error')
      );
    });
  });
});

const core = require('@actions/core');
const {
  WAFv2Client,
  UpdateIPSetCommand,
  GetIPSetCommand,
} = require('@aws-sdk/client-wafv2');
const {
  EC2Client,
  RevokeSecurityGroupIngressCommand,
} = require('@aws-sdk/client-ec2');

/**
 * Configure AWS client
 * @param {string} region AWS region
 * @returns {WAFv2Client} Configured WAF client
 */
function createWAFClient(region) {
  // Use AWS SDK default credential chain
  // This will automatically pick up credentials from:
  // - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN)
  // - IAM roles (for self-hosted runners)
  // - Credentials set by actions like aws-actions/configure-aws-credentials
  return new WAFv2Client({ region });
}

/**
 * Configure AWS EC2 client
 * @param {string} region AWS region
 * @returns {EC2Client} Configured EC2 client
 */
function createEC2Client(region) {
  // Use AWS SDK default credential chain
  return new EC2Client({ region });
}

/**
 * Remove IP address from WAF IPSet with locking mechanism
 * @param {WAFv2Client} client WAF client
 * @param {string} id IPSet ID
 * @param {string} name IPSet name
 * @param {string} scope IPSet scope
 * @param {string} ipAddress IP address to remove
 */
async function removeIPFromIPSet(client, id, name, scope, ipAddress) {
  const maxRetries = 10;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      core.info(
        `Cleanup attempt ${attempt + 1}: Getting current IPSet state...`,
      );

      // Get current IPSet
      const getCommand = new GetIPSetCommand({
        Id: id,
        Name: name,
        Scope: scope,
      });

      const ipSetResponse = await client.send(getCommand);
      const currentAddresses = ipSetResponse.IPSet.Addresses || [];

      // Check if IP is in the set
      if (!currentAddresses.includes(ipAddress)) {
        core.info(`IP ${ipAddress} is not in the IPSet, no cleanup needed`);
        return;
      }

      // Remove the IP from the list
      const updatedAddresses = currentAddresses.filter(
        (addr) => addr !== ipAddress,
      );

      core.info(`Removing IP ${ipAddress} from IPSet ${name}...`);

      // Update IPSet
      const updateCommand = new UpdateIPSetCommand({
        Id: id,
        Name: name,
        Scope: scope,
        Addresses: updatedAddresses,
        LockToken: ipSetResponse.LockToken,
      });

      await client.send(updateCommand);
      core.info(`Successfully removed IP ${ipAddress} from IPSet ${name}`);

      return;
    } catch (error) {
      if (error.name === 'WAFOptimisticLockException') {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        core.warning(
          `Lock conflict detected during cleanup, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Log cleanup errors but don't fail the action
      core.warning(`Cleanup attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt === maxRetries - 1) {
        core.warning(
          `Failed to cleanup IP after ${maxRetries} attempts. Manual cleanup may be required.`,
        );
        return;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Remove IP address from Security Group with retry mechanism
 * @param {EC2Client} client EC2 client
 * @param {string} groupId Security Group ID
 * @param {string} ipAddress IP address to remove
 * @param {string} description Description for the rule
 */
async function removeIPFromSecurityGroup(client, groupId, ipAddress, description) {
  const maxRetries = 5;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      core.info(
        `Cleanup attempt ${attempt + 1}: Removing IP ${ipAddress} from Security Group ${groupId}...`,
      );

      const command = new RevokeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [
              {
                CidrIp: ipAddress,
                Description: description,
              },
            ],
          },
        ],
      });

      await client.send(command);
      core.info(
        `Successfully removed IP ${ipAddress} from Security Group ${groupId}`,
      );

      return;
    } catch (error) {
      if (error.name === 'InvalidPermission.NotFound') {
        core.info(
          `IP ${ipAddress} is not in Security Group ${groupId}, no cleanup needed`,
        );
        return;
      }

      // Log cleanup errors but don't fail the action
      core.warning(
        `Cleanup attempt ${attempt + 1} failed: ${error.message}`,
      );
      if (attempt === maxRetries - 1) {
        core.warning(
          `Failed to cleanup IP from Security Group after ${maxRetries} attempts. Manual cleanup may be required.`,
        );
        return;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function cleanup() {
  try {
    // Get stored state from the main action
    const runnerIP = core.getState('runner-ip');
    const ipsetId = core.getState('ipset-id');
    const ipsetName = core.getState('ipset-name');
    const ipsetScope = core.getState('ipset-scope');
    const awsRegion = core.getState('aws-region');

    // Get Security Group state
    const sgRunnerIP = core.getState('sg-runner-ip');
    const sgGroupId = core.getState('sg-group-id');
    const sgDescription = core.getState('sg-description');
    const sgAwsRegion = core.getState('sg-aws-region');

    const hasWafState = runnerIP && ipsetId && ipsetName && ipsetScope && awsRegion;
    const hasSecurityGroupState = sgRunnerIP && sgGroupId && sgAwsRegion;

    if (!hasWafState && !hasSecurityGroupState) {
      core.info('No cleanup state found, skipping IP removal');
      return;
    }

    // Cleanup WAF IPSet if needed
    if (hasWafState) {
      core.info(
        `Starting WAF cleanup: removing ${runnerIP} from IPSet ${ipsetName} (${ipsetId})`,
      );

      const wafClient = createWAFClient(awsRegion);
      await removeIPFromIPSet(
        wafClient,
        ipsetId,
        ipsetName,
        ipsetScope,
        runnerIP,
      );

      core.info('WAF cleanup completed successfully');
    }

    // Cleanup Security Group if needed
    if (hasSecurityGroupState) {
      core.info(
        `Starting Security Group cleanup: removing ${sgRunnerIP} from Security Group ${sgGroupId}`,
      );

      const ec2Client = createEC2Client(sgAwsRegion);
      await removeIPFromSecurityGroup(
        ec2Client,
        sgGroupId,
        sgRunnerIP,
        sgDescription,
      );

      core.info('Security Group cleanup completed successfully');
    }

    core.info('All cleanup operations completed successfully');
  } catch (error) {
    // Don't fail the action on cleanup errors, just log them
    core.warning(`Cleanup failed: ${error.message}`);
    core.debug(error.stack);
  }
}

// Run cleanup
cleanup();

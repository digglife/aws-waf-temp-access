const core = require('@actions/core');
const {
  WAFv2Client,
  UpdateIPSetCommand,
  GetIPSetCommand,
} = require('@aws-sdk/client-wafv2');
const {
  EC2Client,
  AuthorizeSecurityGroupIngressCommand,
} = require('@aws-sdk/client-ec2');
const axios = require('axios');

/**
 * Get the public IP address of the current GitHub runner
 * @returns {Promise<string>} The public IP address
 */
async function getPublicIP() {
  try {
    const response = await axios.get('https://api.ipify.org?format=text', {
      timeout: 10000,
    });
    return response.data.trim();
  } catch (error) {
    core.debug(
      `Failed to get IP from ipify, trying alternative: ${error.message}`,
    );
    try {
      const response = await axios.get('https://icanhazip.com/', {
        timeout: 10000,
      });
      return response.data.trim();
    } catch (fallbackError) {
      throw new Error(`Failed to get public IP: ${fallbackError.message}`);
    }
  }
}

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
 * Add IP address to WAF IPSet with locking mechanism
 * @param {WAFv2Client} client WAF client
 * @param {string} id IPSet ID
 * @param {string} name IPSet name
 * @param {string} scope IPSet scope
 * @param {string} ipAddress IP address to add
 */
async function addIPToIPSet(client, id, name, scope, ipAddress) {
  const maxRetries = 10;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      core.info(`Attempt ${attempt + 1}: Getting current IPSet state...`);

      // Get current IPSet
      const getCommand = new GetIPSetCommand({
        Id: id,
        Name: name,
        Scope: scope,
      });

      const ipSetResponse = await client.send(getCommand);
      const currentAddresses = ipSetResponse.IPSet.Addresses || [];

      // Check if IP is already in the set
      const ipWithCidr = ipAddress.includes('/')
        ? ipAddress
        : `${ipAddress}/32`;
      if (currentAddresses.includes(ipWithCidr)) {
        core.info(`IP ${ipWithCidr} is already in the IPSet`);
        return;
      }

      // Add the new IP to the list
      const updatedAddresses = [...currentAddresses, ipWithCidr];

      core.info(`Adding IP ${ipWithCidr} to IPSet ${name}...`);

      // Update IPSet
      const updateCommand = new UpdateIPSetCommand({
        Id: id,
        Name: name,
        Scope: scope,
        Addresses: updatedAddresses,
        LockToken: ipSetResponse.LockToken,
      });

      await client.send(updateCommand);
      core.info(`Successfully added IP ${ipWithCidr} to IPSet ${name}`);

      // Store the IP for cleanup
      core.saveState('runner-ip', ipWithCidr);
      core.saveState('ipset-id', id);
      core.saveState('ipset-name', name);
      core.saveState('ipset-scope', scope);
      core.saveState('aws-region', client.config.region);

      return;
    } catch (error) {
      if (error.name === 'WAFOptimisticLockException') {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        core.warning(
          `Lock conflict detected, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to add IP to IPSet after ${maxRetries} attempts due to lock conflicts`,
  );
}

/**
 * Add IP address to Security Group with retry mechanism
 * @param {EC2Client} client EC2 client
 * @param {string} groupId Security Group ID
 * @param {string} ipAddress IP address to add
 * @param {string} description Description for the rule
 */
async function addIPToSecurityGroup(client, groupId, ipAddress, description) {
  const maxRetries = 5;
  const baseDelay = 1000; // 1 second

  const ipWithCidr = ipAddress.includes('/') ? ipAddress : `${ipAddress}/32`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      core.info(`Adding IP ${ipWithCidr} to Security Group ${groupId}...`);

      const command = new AuthorizeSecurityGroupIngressCommand({
        GroupId: groupId,
        IpPermissions: [
          {
            IpProtocol: 'tcp',
            FromPort: 443,
            ToPort: 443,
            IpRanges: [
              {
                CidrIp: ipWithCidr,
                Description: description,
              },
            ],
          },
        ],
      });

      await client.send(command);
      core.info(
        `Successfully added IP ${ipWithCidr} to Security Group ${groupId}`,
      );

      // Store the information for cleanup
      core.saveState('sg-runner-ip', ipWithCidr);
      core.saveState('sg-group-id', groupId);
      core.saveState('sg-description', description);
      core.saveState('sg-aws-region', client.config.region);

      return;
    } catch (error) {
      if (error.name === 'InvalidPermission.Duplicate') {
        core.info(`IP ${ipWithCidr} is already allowed in Security Group ${groupId}`);
        return;
      }

      if (attempt === maxRetries - 1) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      core.warning(
        `Attempt ${attempt + 1} failed, retrying in ${delay}ms... Error: ${error.message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function main() {
  try {
    // Get inputs
    const id = core.getInput('id');
    const name = core.getInput('name');
    const scope = core.getInput('scope');
    const region = core.getInput('region', { required: true });
    const securityGroupId = core.getInput('security-group-id');
    const securityGroupDescription = core.getInput('security-group-description');

    // Validate that at least one target is specified
    const hasWafConfig = id && name;
    const hasSecurityGroupConfig = securityGroupId;

    if (!hasWafConfig && !hasSecurityGroupConfig) {
      throw new Error(
        'Either WAF IPSet configuration (id, name) or Security Group configuration (security-group-id) must be provided',
      );
    }

    core.info(`Starting AWS access management in ${region}`);
    if (hasWafConfig) {
      core.info(`WAF IPSet target: ${name} (${id})`);
    }
    if (hasSecurityGroupConfig) {
      core.info(`Security Group target: ${securityGroupId}`);
    }

    // Validate WAF scope if WAF is configured
    if (hasWafConfig && !['CLOUDFRONT', 'REGIONAL'].includes(scope)) {
      throw new Error(
        `Invalid scope: ${scope}. Must be CLOUDFRONT or REGIONAL`,
      );
    }

    // Get public IP
    core.info('Getting public IP address...');
    const publicIP = await getPublicIP();
    core.info(`Public IP detected: ${publicIP}`);

    // Handle WAF IPSet if configured
    if (hasWafConfig) {
      const wafClient = createWAFClient(region);
      await addIPToIPSet(wafClient, id, name, scope, publicIP);
    }

    // Handle Security Group if configured
    if (hasSecurityGroupConfig) {
      const ec2Client = createEC2Client(region);
      await addIPToSecurityGroup(
        ec2Client,
        securityGroupId,
        publicIP,
        securityGroupDescription,
      );
    }

    core.setOutput('ip-address', publicIP);
    core.setOutput('status', 'success');
  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
    core.debug(error.stack);
  }
}

// Run the action
main();

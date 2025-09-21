# aws-waf-temp-access

[![Tests](https://github.com/digglife/aws-waf-temp-access/actions/workflows/test.yml/badge.svg)](https://github.com/digglife/aws-waf-temp-access/actions/workflows/test.yml)
[![Release](https://github.com/digglife/aws-waf-temp-access/actions/workflows/release.yml/badge.svg)](https://github.com/digglife/aws-waf-temp-access/actions/workflows/release.yml)
[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-aws--waf--temp--access-blue.svg?colorA=24292e&colorB=0366d6&style=flat&longCache=true&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAM6wAADOsB5dZE0gAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAERSURBVCiRhZG/SsMxFEZPfsVJ61jbxaF0cRQRcRJ9hlYn30IHN/+9iquDCOIsblIrOjqKgy5aKoJQj4n3EX+GvTUXAstGoCU+h9oeRJXbCxNyPF1wIv1b3rh+E6K2Uq3tpv0tDmPU6A4hJiNm5prtZs/M12VKQjOGqVxJA3U5DU6PCCi6N8vkLMJOA/xH3/JhVhj9SWHBV5hCOFzO1PSI6o2E6JbOjyeBa3MFQl9aLl5CKNHd9TYW6+UWXNBg6vtJ+IhhDo4/BnJW0hKePEJJJH6fWGIXg+lNmcCy6mGhc9VuIU+4DsL8W9vBGJJCO4dWh3S4hZHjpTf8k/YB8LkNfhj8DgEP5z/IkBcHHR5nOJ8AAAAASUVORK5CYII=)](https://github.com/marketplace/actions/aws-waf-temp-access)

A GitHub Action that automatically adds the current GitHub runner's public IP address to an AWS WAF IPSet and removes it after the workflow completes. This is useful for allowing temporary access from GitHub Actions runners to resources protected by AWS WAF.

## Features

- ✅ Automatically detects and adds the GitHub runner's public IP to an AWS WAF IPSet
- ✅ Removes the IP address after the workflow completes (success or failure)
- ✅ Supports optimistic locking to handle concurrent access to the same IPSet
- ✅ Works with both CloudFront (CLOUDFRONT) and Regional (REGIONAL) IPSets
- ✅ Configurable AWS region support
- ✅ Uses the latest AWS SDK v3

## Usage

### Basic Usage

```yaml
steps:
  - name: Configure AWS credentials
    uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-actions-role
      aws-region: us-east-1
      
  - name: Add runner IP to WAF IPSet
    uses: digglife/aws-waf-temp-access@v1
    with:
      id: 'your-ipset-id-here'
      name: 'your-ipset-name'
      scope: 'REGIONAL'
      region: 'us-east-1'
```

### Complete Workflow Example

```yaml
name: Deploy with WAF Protection
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/github-actions-role
          aws-region: us-west-2
      
      - name: Add runner IP to WAF IPSet
        uses: digglife/aws-waf-temp-access@v1
        with:
          id: 'abcdef12-3456-7890-abcd-ef1234567890'
          name: 'github-runners-ipset'
          scope: 'REGIONAL'
          region: 'us-west-2'
      
      # Your deployment steps here
      - name: Deploy application
        run: |
          echo "Deploying application..."
          # The runner IP is now allowed through WAF
      
      # IP cleanup happens automatically in post-action
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `id` | The ID of the IPSet | ✅ Yes | |
| `name` | The name of the IPSet | ✅ Yes | |
| `scope` | The scope of the IPSet (`CLOUDFRONT` or `REGIONAL`) | ✅ Yes | `REGIONAL` |
| `region` | The AWS region for the IPSet | ✅ Yes | `us-east-1` |

## Outputs

| Output | Description |
|--------|-------------|
| `ip-address` | The public IP address that was added to the IPSet |
| `status` | Status of the operation (`success` or `failed`) |

## AWS Permissions

The action requires the following AWS IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "wafv2:GetIPSet",
        "wafv2:UpdateIPSet"
      ],
      "Resource": "arn:aws:wafv2:*:*:*/ipset/*/*"
    }
  ]
}
```

For more restrictive permissions, you can specify the exact IPSet ARN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "wafv2:GetIPSet",
        "wafv2:UpdateIPSet"
      ],
      "Resource": "arn:aws:wafv2:us-west-2:123456789012:regional/ipset/github-runners-ipset/abcdef12-3456-7890-abcd-ef1234567890"
    }
  ]
}
```

## Authentication

This action uses the AWS SDK's default credential chain to authenticate with AWS. You can provide credentials using any of the following methods:

### Option 1: aws-actions/configure-aws-credentials (Recommended)

```yaml
steps:
  - name: Configure AWS credentials
    uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/github-actions-role
      aws-region: us-west-2
      
  - name: Add runner IP to WAF IPSet
    uses: digglife/aws-waf-temp-access@v1
    with:
      id: 'your-ipset-id-here'
      name: 'your-ipset-name'
      scope: 'REGIONAL'
      region: 'us-west-2'
```

### Option 2: Environment Variables

```yaml
steps:
  - name: Add runner IP to WAF IPSet
    uses: digglife/aws-waf-temp-access@v1
    with:
      id: 'your-ipset-id-here'
      name: 'your-ipset-name'
      scope: 'REGIONAL'
      region: 'us-west-2'
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      AWS_SESSION_TOKEN: ${{ secrets.AWS_SESSION_TOKEN }} # Optional for temporary credentials
```

### Option 3: IAM Roles (Self-hosted runners)

If running on self-hosted runners with IAM roles attached, no explicit credential configuration is needed.

## How It Works

1. **IP Detection**: The action detects the public IP address of the GitHub runner using external services
2. **IPSet Update**: Adds the IP address (with /32 CIDR) to the specified AWS WAF IPSet
3. **Locking**: Uses AWS WAF's optimistic locking to handle concurrent updates safely
4. **Cleanup**: Automatically removes the IP address when the workflow completes (via post-action)

## Concurrent Usage

The action supports multiple workflows running simultaneously against the same IPSet through:
- Optimistic locking with automatic retry logic
- Exponential backoff with jitter for lock conflicts
- Safe addition/removal of IP addresses without affecting other entries

## Error Handling

- If IP detection fails, the action will try alternative services
- Lock conflicts are automatically retried with exponential backoff
- Cleanup failures are logged as warnings but don't fail the workflow
- Detailed logging helps with troubleshooting

## Security Considerations

- IP addresses are automatically cleaned up after workflow completion
- The action only adds/removes the specific runner's IP address
- Uses HTTPS for IP detection services
- Supports AWS temporary credentials and IAM roles

## Troubleshooting

### Common Issues

**Error: "Failed to get public IP"**
- Check if the runner has internet access
- Verify firewall settings allow HTTPS requests

**Error: "Access Denied"**
- Verify AWS credentials are correct
- Check IAM permissions include `wafv2:GetIPSet` and `wafv2:UpdateIPSet`
- Ensure the IPSet exists and the ID/name are correct

**Error: "IPSet not found"**
- Verify the IPSet ID, name, scope, and region are correct
- Ensure the IPSet exists in the specified region

**Lock conflicts persist**
- This is normal with high concurrency; the action will retry automatically
- If issues persist, consider staggering workflow starts

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

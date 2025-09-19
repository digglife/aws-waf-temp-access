# AWS WAF IPSet Update Action

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
  - name: Add runner IP to WAF IPSet
    uses: digglife/aws-waf-ipset-update@v1
    with:
      id: 'your-ipset-id-here'
      name: 'your-ipset-name'
      scope: 'REGIONAL'
      region: 'us-east-1'
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
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
      
      - name: Add runner IP to WAF IPSet
        uses: digglife/aws-waf-ipset-update@v1
        with:
          id: 'abcdef12-3456-7890-abcd-ef1234567890'
          name: 'github-runners-ipset'
          scope: 'REGIONAL'
          region: 'us-west-2'
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      
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
| `aws-access-key-id` | AWS Access Key ID (alternatively use environment variables) | No | |
| `aws-secret-access-key` | AWS Secret Access Key (alternatively use environment variables) | No | |
| `aws-session-token` | AWS Session Token for temporary credentials | No | |

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

### Option 1: Environment Variables (Recommended)

```yaml
env:
  AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
  AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  AWS_SESSION_TOKEN: ${{ secrets.AWS_SESSION_TOKEN }} # Optional for temporary credentials
```

### Option 2: Action Inputs

```yaml
with:
  aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
  aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
  aws-session-token: ${{ secrets.AWS_SESSION_TOKEN }} # Optional
```

### Option 3: IAM Roles (Self-hosted runners)

If running on self-hosted runners with IAM roles attached, no credentials need to be provided.

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
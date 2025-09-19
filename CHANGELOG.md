# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Simplified AWS authentication by removing manual credential handling
- Action now relies on AWS SDK's default credential chain for authentication
- Removed `aws-access-key-id`, `aws-secret-access-key`, and `aws-session-token` input parameters
- Updated documentation to recommend using `aws-actions/configure-aws-credentials`

### Improved
- Better compatibility with existing AWS credential management actions
- Cleaner action interface with fewer parameters
- More flexible authentication options through AWS SDK defaults

## [1.0.0] - 2024-09-19

### Added
- Initial release of AWS WAF IPSet Update GitHub Action
- Automatic detection and addition of GitHub runner's public IP to AWS WAF IPSet
- Automatic cleanup of IP address after workflow completion
- Support for optimistic locking to handle concurrent access
- Support for both CloudFront (CLOUDFRONT) and Regional (REGIONAL) IPSets
- Configurable AWS region support
- Comprehensive error handling and retry logic
- Full documentation and examples

### Features
- Uses AWS SDK v3 for latest compatibility
- Exponential backoff with jitter for lock conflict resolution
- Fallback IP detection services for reliability
- Detailed logging for troubleshooting
- Support for various AWS authentication methods
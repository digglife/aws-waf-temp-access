# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
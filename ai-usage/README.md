# AI Usage

AI tools were used as an engineering assistant throughout the implementation.

The AI was primarily used for:

- Initial architecture exploration and trade-off discussions
- Service and worker scaffolding
- SQS/S3 integration patterns
- Meta API pagination and error handling
- Test case generation
- Code review and troubleshooting

AI-generated code and recommendations were treated as suggestions rather than final implementation decisions. I reviewed, adapted, tested, and manually validated the resulting implementation.

In particular, the following areas were manually investigated and validated:

- Meta Graph API behaviour and pagination limits
- AWS SQS permissions, visibility timeout and DLQ behaviour
- S3 upload workflow
- Idempotency and duplicate message handling
- PostgreSQL constraints and batch insertion behaviour
- End-to-end worker processing
- Type checking, linting and automated tests

The final architecture, implementation decisions, trade-offs, and production considerations were reviewed and validated by me.

See `chat-history.md` for the relevant AI-assisted development discussion.

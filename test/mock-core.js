/**
 * Mock @actions/core for local testing
 */
class MockCore {
    constructor(inputs = {}) {
        this.inputs = inputs;
        this.failureMessage = null;
    }

    getInput(name) {
        return this.inputs[name] || "";
    }

    setFailed(message) {
        this.failureMessage = message;
        console.error(`❌ Action failed: ${message}`);
        process.exit(1);
    }

    info(message) {
        console.log(`ℹ️  ${message}`);
    }

    warning(message) {
        console.warn(`⚠️  ${message}`);
    }
}

module.exports = MockCore;

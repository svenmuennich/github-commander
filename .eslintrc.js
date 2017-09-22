module.exports = {
    'extends': 'airbnb-base',
    'plugins': [
        'import',
        'filenames'
    ],
    'rules': {
        'no-console': 'off',
        'max-len': ['warn', 120],
        'no-param-reassign': 'off',
        'comma-dangle': ['error', {
            arrays: 'always-multiline',
            objects: 'always-multiline',
            imports: 'always-multiline',
            exports: 'always-multiline',
            functions: 'never',
        }],
        'class-methods-use-this': 'off',
        'func-names': 'off',
        'newline-before-return': ['error'],
        'indent': ['error', 4, { 'SwitchCase': 1 }],
        'no-use-before-define': ['error', { 'functions': false }],
        'filenames/match-regex': 'error',
    },
};

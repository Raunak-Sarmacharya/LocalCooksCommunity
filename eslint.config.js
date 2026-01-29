import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'build'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
            react,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-hooks/rules-of-hooks': 'warn',
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-require-imports': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/no-namespace': 'warn',
            'no-unused-vars': 'off',
            'react/no-unescaped-entities': 'warn',
            'no-case-declarations': 'warn',
            'no-prototype-builtins': 'warn',
            ...react.configs.recommended.rules,
            ...react.configs['jsx-runtime'].rules,
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        files: ['tailwind.config.ts'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        }
    }
);

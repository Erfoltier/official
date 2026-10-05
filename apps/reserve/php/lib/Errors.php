<?php
declare(strict_types=1);

/** 予約・患者などの処理のエラー（Node.js 版の StoreError と同じ） */
final class StoreError extends RuntimeException
{
    public function __construct(public readonly string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

/** ログイン・権限のエラー（Node.js 版の AuthError と同じ） */
final class AuthError extends RuntimeException
{
    public function __construct(public readonly string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

/** 入力の形が正しくない（Node.js 版の zod の検証エラーにあたる） */
final class InputError extends RuntimeException
{
}

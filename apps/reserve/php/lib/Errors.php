<?php
declare(strict_types=1);

/** 予約・患者などの処理のエラー */
final class StoreError extends RuntimeException
{
    public function __construct(public readonly string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

/** ログイン・権限のエラー */
final class AuthError extends RuntimeException
{
    public function __construct(public readonly string $codeName, string $message)
    {
        parent::__construct($message);
    }
}

/** 入力の形が正しくない */
final class InputError extends RuntimeException
{
}

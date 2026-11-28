#!/usr/bin/env python3
"""
予約システムのサーバーを、AWS Backup の毎日の控えから立て直す（docs/RECOVERY.md）。
Claude（AWS の管理者 claude-ops）が流す。院長・スタッフの操作は要らない。

  python3 ops/restore.py drill   # 練習：外へ通信できない状態で立てて中身を確かめ、消す（患者に何も送らない）
  python3 ops/restore.py real    # 本番：いちばん新しい控えから立て、固定のアドレス（Elastic IP）を新しいサーバーへ移す
  python3 ops/restore.py real --region ap-northeast-3   # 東京ごと止まったとき：大阪の写しから（アドレスは DNS で切り替え）

2026-11-02 の練習：控えから立つまで 92 秒、起動して中身を確かめられるまで約3分。
"""
import json, sys, time
import boto3

PROD = "i-080e478ee9bffc889"
EIP_ALLOC = "eipalloc-0f8f7ba2127ce9c21"
VAULTS = {"ap-northeast-1": "ishida-vault", "ap-northeast-3": "ishida-vault-osaka"}
ROLE = "arn:aws:iam::965825500741:role/ishida-backup"


def latest_point(b, vault):
    pts = [p for p in b.list_recovery_points_by_backup_vault(BackupVaultName=vault)["RecoveryPoints"] if p["ResourceType"] == "EC2" and p["Status"] == "COMPLETED"]
    return sorted(pts, key=lambda p: p["CreationDate"])[-1]


def restore(region, net):
    b = boto3.client("backup", region_name=region)
    p = latest_point(b, VAULTS[region])
    print("控え:", p["CreationDate"])
    md = b.get_recovery_point_restore_metadata(BackupVaultName=VAULTS[region], RecoveryPointArn=p["RecoveryPointArn"])["RestoreMetadata"]
    md.pop("aws:backup:request-id", None)
    md["DisableApiTermination"] = "false"
    md.update(net)
    t0 = time.time()
    job = b.start_restore_job(RecoveryPointArn=p["RecoveryPointArn"], IamRoleArn=ROLE, Metadata=md, ResourceType="EC2")["RestoreJobId"]
    while True:
        j = b.describe_restore_job(RestoreJobId=job)
        if j["Status"] in ("COMPLETED", "FAILED", "ABORTED"):
            break
        time.sleep(15)
    print(j["Status"], j.get("StatusMessage", ""), f"{round(time.time() - t0)}秒")
    if j["Status"] != "COMPLETED":
        sys.exit(1)
    return j["CreatedResourceArn"].split("/")[-1]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    region = sys.argv[sys.argv.index("--region") + 1] if "--region" in sys.argv else "ap-northeast-1"
    ec2 = boto3.client("ec2", region_name=region)
    if mode == "real":
        if region == "ap-northeast-1":
            prod = ec2.describe_instances(InstanceIds=[PROD])["Reservations"][0]["Instances"][0]
            net = {"SubnetId": prod["SubnetId"], "SecurityGroupIds": json.dumps([g["GroupId"] for g in prod["SecurityGroups"]])}
        else:
            # 大阪：既定の VPC に、80・443 だけを開けた入口を作る
            vpc = ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])["Vpcs"][0]["VpcId"]
            try:
                sg = ec2.create_security_group(GroupName="lane-reserve-web", Description="LANE RESERVE web 80/443", VpcId=vpc)["GroupId"]
                ec2.authorize_security_group_ingress(GroupId=sg, IpPermissions=[{"IpProtocol": "tcp", "FromPort": p, "ToPort": p, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]} for p in (80, 443)])
            except ec2.exceptions.ClientError:
                sg = ec2.describe_security_groups(Filters=[{"Name": "group-name", "Values": ["lane-reserve-web"]}])["SecurityGroups"][0]["GroupId"]
            sub = ec2.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpc]}, {"Name": "default-for-az", "Values": ["true"]}])["Subnets"][0]
            net = {"SecurityGroupIds": json.dumps([sg]), "SubnetId": sub["SubnetId"], "Placement": json.dumps({"AvailabilityZone": sub["AvailabilityZone"]})}
        inst = restore(region, net)
        ec2.get_waiter("instance_running").wait(InstanceIds=[inst])
        if region == "ap-northeast-1":
            ec2.associate_address(AllocationId=EIP_ALLOC, InstanceId=inst, AllowReassociation=True)
            print("固定のアドレスを新しいサーバーへ移しました:", inst)
        else:
            ip = ec2.allocate_address(Domain="vpc")
            ec2.associate_address(AllocationId=ip["AllocationId"], InstanceId=inst)
            r53 = boto3.client("route53")
            zone = r53.list_hosted_zones_by_name(DNSName="ishidahihuka.jp.")["HostedZones"][0]["Id"]
            r53.change_resource_record_sets(HostedZoneId=zone, ChangeBatch={"Changes": [
                {"Action": "UPSERT", "ResourceRecordSet": {"Name": f"{n}.ishidahihuka.jp.", "Type": "A", "TTL": 300, "ResourceRecords": [{"Value": ip["PublicIp"]}]}}
                for n in ("reserve", "monshin")
            ]})
            print("大阪の新しいサーバー:", inst, ip["PublicIp"], "→ reserve・monshin の向き先を変えました（5分ほどで切り替わる）")
        print("次：docs/RECOVERY.md の「立てたあと」を行う（最新版の反映・紙の記録の入力・古いサーバーの停止）")
    elif mode == "drill":
        print("練習は 2026-11-02 の手順（外への通信を断った専用の入口と SSM の通り道を作ってから立てる）で行う。docs/RECOVERY.md「練習」")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

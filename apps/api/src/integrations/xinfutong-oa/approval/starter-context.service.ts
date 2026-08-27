import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class OaStarterContextService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(userId: string, organizationId: bigint) {
    const [user, organization] = await Promise.all([
      this.prisma.hspsi_sys_user.findFirst({
        where: { id: BigInt(userId), status: 1, deleted_at: null },
        select: { staff_id: true },
      }),
      this.prisma.hspsi_basic_organization.findFirst({
        where: { org_id: organizationId, deleted_at: null },
        select: { account_set_id: true },
      }),
    ]);
    if (!user) throw new BadRequestException('提交人账号不存在或已停用');
    if (!organization?.account_set_id) throw new BadRequestException('单据所属组织未关联OA账套');
    const identity = await this.prisma.hspsi_sys_user_oa_staff.findFirst({
      where: { user_id: BigInt(userId), account_set_id: organization.account_set_id },
      select: { staff_id: true },
    });
    const staffId = identity?.staff_id ?? user.staff_id;
    if (!staffId) throw new BadRequestException('提交人账号尚未关联OA员工');
    const staff = await this.prisma.hspsi_basic_staff.findFirst({
      where: {
        id: staffId,
        account_set_id: organization.account_set_id,
        status: 1,
        deleted_at: null,
      },
      select: { id: true, outer_ref_id: true, out_staff_id: true, name: true },
    });
    if (!staff?.outer_ref_id) throw new BadRequestException('提交人尚未关联有效OA账号');
    const membership = await this.prisma.hspsi_basic_staff_organizations.findFirst({
      where: {
        staff_id: staff.id,
        account_set_id: organization.account_set_id,
        type: 1,
        deleted_at: null,
      },
      orderBy: [{ org_type: 'desc' }, { id: 'asc' }],
    });
    if (!membership) throw new BadRequestException('提交人没有有效的OA主部门');
    const starterOrg =
      membership.org_type === 2
        ? await this.prisma.hspsi_basic_dept.findFirst({
            where: { dept_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          })
        : await this.prisma.hspsi_basic_organization.findFirst({
            where: { org_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          });
    if (!starterOrg?.outer_ref_id) throw new BadRequestException('提交人的OA主部门标识缺失');
    return {
      accountSetId: organization.account_set_id,
      starterId: staff.outer_ref_id,
      starterOrgId: starterOrg.outer_ref_id,
      staff,
    };
  }

  async resolvePerson(userId: bigint, accountSetId: bigint) {
    const user = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: userId, status: 1, deleted_at: null },
      select: { staff_id: true },
    });
    if (!user) throw new BadRequestException('人员账号不存在或已停用');
    const identity = await this.prisma.hspsi_sys_user_oa_staff.findFirst({
      where: { user_id: userId, account_set_id: accountSetId },
      select: { staff_id: true },
    });
    const staffId = identity?.staff_id ?? user.staff_id;
    if (!staffId) throw new BadRequestException('人员账号尚未关联OA员工');
    const staff = await this.prisma.hspsi_basic_staff.findFirst({
      where: { id: staffId, account_set_id: accountSetId, status: 1, deleted_at: null },
      select: { id: true, name: true, outer_ref_id: true, out_staff_id: true },
    });
    if (!staff?.outer_ref_id || !staff.out_staff_id) {
      throw new BadRequestException('人员尚未关联有效OA账号');
    }
    const membership = await this.prisma.hspsi_basic_staff_organizations.findFirst({
      where: { staff_id: staff.id, account_set_id: accountSetId, type: 1, deleted_at: null },
      orderBy: [{ org_type: 'desc' }, { id: 'asc' }],
    });
    if (!membership) throw new BadRequestException('人员没有有效的OA主部门');
    const org =
      membership.org_type === 2
        ? await this.prisma.hspsi_basic_dept.findFirst({
            where: { dept_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          })
        : await this.prisma.hspsi_basic_organization.findFirst({
            where: { org_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          });
    if (!org?.outer_ref_id) throw new BadRequestException('人员OA主部门标识缺失');
    return {
      USRNAM: staff.name,
      STFSEQ: staff.out_staff_id,
      USRNBR: staff.outer_ref_id,
      ORGSEQ: org.outer_ref_id,
    };
  }
}
